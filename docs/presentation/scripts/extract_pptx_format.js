#!/usr/bin/env node
/**
 * @file extract_pptx_format.js
 * @description Extracts complete OOXML formatting metadata from a PowerPoint (.pptx)
 * presentation—including exact slide dimensions, theme colors & font schemes,
 * slide master & layout definitions, shape bounding boxes, text body margins/insets,
 * paragraph spacing/indentation/bullets, run fonts/sizes/colors, table geometry/styles,
 * and embedded images—so a generator script can replicate the template precisely.
 *
 * Usage:
 *   node docs/presentation/scripts/extract_pptx_format.js [input.pptx] [output.json]
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const JSZip = require(path.join(REPO_ROOT, 'frontend/node_modules/jszip'));

const EMU_PER_INCH = 914400;
const EMU_PER_PT = 12700;
const EMU_PER_CM = 360000;

function emuToUnits(emuStr) {
  if (emuStr === undefined || emuStr === null || emuStr === '') return null;
  const emu = Number(emuStr);
  if (!Number.isFinite(emu)) return null;
  return {
    emu,
    inches: Number((emu / EMU_PER_INCH).toFixed(4)),
    pt: Number((emu / EMU_PER_PT).toFixed(2)),
    cm: Number((emu / EMU_PER_CM).toFixed(3)),
  };
}

function getAttr(tag, name) {
  if (!tag) return null;
  const re = new RegExp(`\\b${name}="([^"]*)"`);
  const m = tag.match(re);
  return m ? m[1] : null;
}

function decodeXml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/**
 * Extracts balanced XML elements matching a tag name (supports nested tags of same name).
 */
function extractElements(xml, tagName) {
  if (!xml) return [];
  const results = [];
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;
  let pos = 0;

  while (pos < xml.length) {
    const start = xml.indexOf(openToken, pos);
    if (start === -1) break;

    // Ensure exact tag name boundary
    const nextChar = xml[start + openToken.length];
    if (nextChar !== ' ' && nextChar !== '>' && nextChar !== '/' && nextChar !== '\t' && nextChar !== '\r' && nextChar !== '\n') {
      pos = start + openToken.length;
      continue;
    }

    const firstCloseBracket = xml.indexOf('>', start);
    if (firstCloseBracket === -1) break;

    // Self-closing tag
    if (xml[firstCloseBracket - 1] === '/') {
      results.push(xml.slice(start, firstCloseBracket + 1));
      pos = firstCloseBracket + 1;
      continue;
    }

    // Track nesting depth
    let depth = 1;
    let cursor = firstCloseBracket + 1;
    while (depth > 0 && cursor < xml.length) {
      const nextOpen = xml.indexOf(openToken, cursor);
      const nextClose = xml.indexOf(closeToken, cursor);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        const boundary = xml[nextOpen + openToken.length];
        if (boundary === ' ' || boundary === '>' || boundary === '/' || boundary === '\t' || boundary === '\r' || boundary === '\n') {
          const innerEnd = xml.indexOf('>', nextOpen);
          if (innerEnd !== -1 && xml[innerEnd - 1] !== '/') {
            depth++;
          }
          cursor = innerEnd !== -1 ? innerEnd + 1 : nextOpen + openToken.length;
          continue;
        }
        cursor = nextOpen + openToken.length;
        continue;
      }

      depth--;
      cursor = nextClose + closeToken.length;
    }

    results.push(xml.slice(start, cursor));
    pos = cursor;
  }

  return results;
}

function extractOpeningTag(elemXml) {
  const idx = elemXml.indexOf('>');
  return idx === -1 ? elemXml : elemXml.slice(0, idx + 1);
}

function parseColor(xmlFragment) {
  if (!xmlFragment) return null;
  const srgb = xmlFragment.match(/<a:srgbClr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:srgbClr>)/);
  if (srgb) {
    const val = getAttr(srgb[1], 'val');
    const alpha = srgb[2] ? getAttr(srgb[2], 'val') : null;
    return { type: 'srgb', hex: `#${val}`, alpha: alpha ? Number(alpha) / 1000 : null };
  }
  const scheme = xmlFragment.match(/<a:schemeClr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:schemeClr>)/);
  if (scheme) {
    const val = getAttr(scheme[1], 'val');
    const inner = scheme[2] || '';
    const lumMod = inner.match(/<a:lumMod\b[^>]*val="(\d+)"/);
    const lumOff = inner.match(/<a:lumOff\b[^>]*val="(-?\d+)"/);
    const tint = inner.match(/<a:tint\b[^>]*val="(\d+)"/);
    const shade = inner.match(/<a:shade\b[^>]*val="(\d+)"/);
    return {
      type: 'scheme',
      scheme: val,
      lumMod: lumMod ? Number(lumMod[1]) / 1000 : null,
      lumOff: lumOff ? Number(lumOff[1]) / 1000 : null,
      tint: tint ? Number(tint[1]) / 1000 : null,
      shade: shade ? Number(shade[1]) / 1000 : null,
    };
  }
  const sys = xmlFragment.match(/<a:sysClr\b([^>]*)/);
  if (sys) {
    return { type: 'sys', val: getAttr(sys[1], 'val'), lastClr: getAttr(sys[1], 'lastClr') ? `#${getAttr(sys[1], 'lastClr')}` : null };
  }
  return null;
}

function parseXfrm(xmlFragment) {
  const xfrms = extractElements(xmlFragment, 'a:xfrm');
  if (!xfrms.length) return null;
  const xfrm = xfrms[0];
  const open = extractOpeningTag(xfrm);
  const offMatch = xfrm.match(/<a:off\b([^>]*)\/>/);
  const extMatch = xfrm.match(/<a:ext\b([^>]*)\/>/);
  return {
    rot: getAttr(open, 'rot') ? Number(getAttr(open, 'rot')) / 60000 : 0,
    flipH: getAttr(open, 'flipH') === '1',
    flipV: getAttr(open, 'flipV') === '1',
    x: offMatch ? emuToUnits(getAttr(offMatch[1], 'x')) : null,
    y: offMatch ? emuToUnits(getAttr(offMatch[1], 'y')) : null,
    cx: extMatch ? emuToUnits(getAttr(extMatch[1], 'cx')) : null,
    cy: extMatch ? emuToUnits(getAttr(extMatch[1], 'cy')) : null,
  };
}

function parseRPr(rPrXml) {
  if (!rPrXml) return null;
  const open = extractOpeningTag(rPrXml);
  const sz = getAttr(open, 'sz');
  const latin = rPrXml.match(/<a:latin\b([^>]*)\/>/);
  const ea = rPrXml.match(/<a:ea\b([^>]*)\/>/);
  const cs = rPrXml.match(/<a:cs\b([^>]*)\/>/);
  const solidFill = extractElements(rPrXml, 'a:solidFill')[0];

  return {
    lang: getAttr(open, 'lang'),
    fontSizePt: sz ? Number(sz) / 100 : null,
    bold: getAttr(open, 'b') === '1' ? true : (getAttr(open, 'b') === '0' ? false : null),
    italic: getAttr(open, 'i') === '1' ? true : (getAttr(open, 'i') === '0' ? false : null),
    underline: getAttr(open, 'u'),
    letterSpacingPt: getAttr(open, 'spc') ? Number(getAttr(open, 'spc')) / 100 : null,
    latinFont: latin ? getAttr(latin[1], 'typeface') : null,
    eaFont: ea ? getAttr(ea[1], 'typeface') : null,
    csFont: cs ? getAttr(cs[1], 'typeface') : null,
    color: solidFill ? parseColor(solidFill) : null,
  };
}

function parseSpacing(tagXml) {
  if (!tagXml) return null;
  const pts = tagXml.match(/<a:spcPts\b[^>]*val="(\d+)"/);
  if (pts) return { unit: 'pt', value: Number(pts[1]) / 100 };
  const pct = tagXml.match(/<a:spcPct\b[^>]*val="(\d+)"/);
  if (pct) return { unit: 'pct', value: Number(pct[1]) / 1000 };
  return null;
}

function parsePPr(pPrXml) {
  if (!pPrXml) return null;
  const open = extractOpeningTag(pPrXml);
  const spcBef = extractElements(pPrXml, 'a:spcBef')[0];
  const spcAft = extractElements(pPrXml, 'a:spcAft')[0];
  const lnSpc = extractElements(pPrXml, 'a:lnSpc')[0];
  const buChar = pPrXml.match(/<a:buChar\b([^>]*)\/>/);
  const buFont = pPrXml.match(/<a:buFont\b([^>]*)\/>/);
  const buClr = extractElements(pPrXml, 'a:buClr')[0];
  const buAutoNum = pPrXml.match(/<a:buAutoNum\b([^>]*)\/>/);
  const buNone = /<a:buNone\b/.test(pPrXml);
  const defRPr = extractElements(pPrXml, 'a:defRPr')[0];

  return {
    align: getAttr(open, 'algn'),
    level: getAttr(open, 'lvl') ? Number(getAttr(open, 'lvl')) : 0,
    marL: emuToUnits(getAttr(open, 'marL')),
    indent: emuToUnits(getAttr(open, 'indent')),
    spaceBefore: parseSpacing(spcBef),
    spaceAfter: parseSpacing(spcAft),
    lineSpacing: parseSpacing(lnSpc),
    bullet: buNone
      ? { type: 'none' }
      : buChar
        ? {
            type: 'char',
            char: decodeXml(getAttr(buChar[1], 'char')),
            font: buFont ? getAttr(buFont[1], 'typeface') : null,
            color: buClr ? parseColor(buClr) : null,
          }
        : buAutoNum
          ? { type: 'autoNum', scheme: getAttr(buAutoNum[1], 'type') }
          : null,
    defaultRunProps: defRPr ? parseRPr(defRPr) : null,
  };
}

function parseTxBody(txBodyXml) {
  if (!txBodyXml) return null;
  const bodyPrMatch = txBodyXml.match(/<a:bodyPr\b([^>]*)(?:\/>|>([\s\S]*?)<\/a:bodyPr>)/);
  const bodyPrAttrs = bodyPrMatch ? bodyPrMatch[1] : '';
  const bodyPrInner = bodyPrMatch ? (bodyPrMatch[2] || '') : '';

  const paragraphs = extractElements(txBodyXml, 'a:p').map((pXml) => {
    const pPr = extractElements(pXml, 'a:pPr')[0];
    const runs = extractElements(pXml, 'a:r').map((rXml) => {
      const rPr = extractElements(rXml, 'a:rPr')[0];
      const tMatch = rXml.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/);
      return {
        text: tMatch ? decodeXml(tMatch[1]) : '',
        props: parseRPr(rPr),
      };
    });
    const text = runs.map((r) => r.text).join('');
    return {
      text,
      props: parsePPr(pPr),
      runs,
    };
  });

  return {
    bodyProps: {
      wrap: getAttr(bodyPrAttrs, 'wrap'),
      anchor: getAttr(bodyPrAttrs, 'anchor'),
      lIns: emuToUnits(getAttr(bodyPrAttrs, 'lIns')),
      rIns: emuToUnits(getAttr(bodyPrAttrs, 'rIns')),
      tIns: emuToUnits(getAttr(bodyPrAttrs, 'tIns')),
      bIns: emuToUnits(getAttr(bodyPrAttrs, 'bIns')),
      autoFit: /<a:spAutoFit\b/.test(bodyPrInner)
        ? 'shape'
        : /<a:normAutofit\b/.test(bodyPrInner)
          ? 'normal'
          : /<a:noAutofit\b/.test(bodyPrInner)
            ? 'none'
            : null,
    },
    paragraphs,
  };
}

function parseShapeFillAndLine(spPrXml) {
  if (!spPrXml) return {};
  const prstGeom = spPrXml.match(/<a:prstGeom\b([^>]*)/);
  const ln = extractElements(spPrXml, 'a:ln')[0];
  // Remove <a:ln> before checking shape fill so we don't confuse line fill with shape fill
  const withoutLn = ln ? spPrXml.replace(ln, '') : spPrXml;
  const solidFill = extractElements(withoutLn, 'a:solidFill')[0];
  const noFill = /<a:noFill\b/.test(withoutLn);

  let outline = null;
  if (ln) {
    const lnOpen = extractOpeningTag(ln);
    const lnFill = extractElements(ln, 'a:solidFill')[0];
    outline = {
      width: emuToUnits(getAttr(lnOpen, 'w')),
      color: lnFill ? parseColor(lnFill) : null,
      noFill: /<a:noFill\b/.test(ln),
    };
  }

  return {
    presetGeometry: prstGeom ? getAttr(prstGeom[1], 'prst') : null,
    fill: noFill ? { type: 'none' } : (solidFill ? parseColor(solidFill) : null),
    outline,
  };
}

function parseRels(relsXml) {
  const map = {};
  if (!relsXml) return map;
  const re = /<Relationship\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(relsXml)) !== null) {
    const id = getAttr(m[1], 'Id');
    const type = getAttr(m[1], 'Type');
    const target = getAttr(m[1], 'Target');
    if (id) map[id] = { type: type ? type.split('/').pop() : null, target };
  }
  return map;
}

function parseSpTree(spTreeXml, relsMap) {
  if (!spTreeXml) return [];
  const items = [];

  // 1. Standard shapes (<p:sp>)
  for (const spXml of extractElements(spTreeXml, 'p:sp')) {
    const cNvPr = spXml.match(/<p:cNvPr\b([^>]*)/);
    const ph = spXml.match(/<p:ph\b([^>]*)/);
    const spPr = extractElements(spXml, 'p:spPr')[0];
    const txBody = extractElements(spXml, 'p:txBody')[0];
    items.push({
      kind: 'shape',
      id: cNvPr ? getAttr(cNvPr[1], 'id') : null,
      name: cNvPr ? getAttr(cNvPr[1], 'name') : null,
      placeholder: ph ? { type: getAttr(ph[1], 'type') || 'body', idx: getAttr(ph[1], 'idx') } : null,
      transform: parseXfrm(spPr),
      style: parseShapeFillAndLine(spPr),
      textBody: parseTxBody(txBody),
    });
  }

  // 2. Pictures (<p:pic>)
  for (const picXml of extractElements(spTreeXml, 'p:pic')) {
    const cNvPr = picXml.match(/<p:cNvPr\b([^>]*)/);
    const blip = picXml.match(/<a:blip\b([^>]*)/);
    const rEmbed = blip ? getAttr(blip[1], 'r:embed') : null;
    const spPr = extractElements(picXml, 'p:spPr')[0];
    items.push({
      kind: 'picture',
      id: cNvPr ? getAttr(cNvPr[1], 'id') : null,
      name: cNvPr ? getAttr(cNvPr[1], 'name') : null,
      rId: rEmbed,
      mediaTarget: rEmbed && relsMap[rEmbed] ? relsMap[rEmbed].target : null,
      transform: parseXfrm(spPr),
    });
  }

  // 3. GraphicFrames — Tables (<p:graphicFrame>)
  for (const gfXml of extractElements(spTreeXml, 'p:graphicFrame')) {
    const cNvPr = gfXml.match(/<p:cNvPr\b([^>]*)/);
    const xfrm = parseXfrm(gfXml);
    const tbl = extractElements(gfXml, 'a:tbl')[0];
    if (!tbl) continue;

    const tblPr = extractElements(tbl, 'a:tblPr')[0];
    const tblStyleMatch = tblPr ? tblPr.match(/<a:tableStyleId>([^<]+)<\/a:tableStyleId>/) : null;
    const gridCols = extractElements(tbl, 'a:gridCol').map((gc) => emuToUnits(getAttr(gc, 'w')));
    const rows = extractElements(tbl, 'a:tr').map((trXml) => {
      const trOpen = extractOpeningTag(trXml);
      const cells = extractElements(trXml, 'a:tc').map((tcXml) => {
        const tcPr = extractElements(tcXml, 'a:tcPr')[0];
        const tcPrOpen = tcPr ? extractOpeningTag(tcPr) : '';
        const fill = tcPr ? extractElements(tcPr, 'a:solidFill')[0] : null;
        const txBody = extractElements(tcXml, 'a:txBody')[0];
        return {
          margins: tcPr
            ? {
                marL: emuToUnits(getAttr(tcPrOpen, 'marL')),
                marR: emuToUnits(getAttr(tcPrOpen, 'marR')),
                marT: emuToUnits(getAttr(tcPrOpen, 'marT')),
                marB: emuToUnits(getAttr(tcPrOpen, 'marB')),
                anchor: getAttr(tcPrOpen, 'anchor'),
              }
            : null,
          fill: fill ? parseColor(fill) : null,
          textBody: parseTxBody(txBody),
        };
      });
      return {
        height: emuToUnits(getAttr(trOpen, 'h')),
        cells,
      };
    });

    items.push({
      kind: 'table',
      id: cNvPr ? getAttr(cNvPr[1], 'id') : null,
      name: cNvPr ? getAttr(cNvPr[1], 'name') : null,
      transform: xfrm,
      tableStyleId: tblStyleMatch ? tblStyleMatch[1] : null,
      columnWidths: gridCols,
      rows,
    });
  }

  return items;
}

function parseTheme(themeXml) {
  if (!themeXml) return null;
  const themeName = getAttr(extractOpeningTag(extractElements(themeXml, 'a:theme')[0] || ''), 'name');
  const clrScheme = extractElements(themeXml, 'a:clrScheme')[0] || '';
  const colorKeys = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const colors = {};
  for (const key of colorKeys) {
    const el = extractElements(clrScheme, `a:${key}`)[0];
    if (el) colors[key] = parseColor(el);
  }

  const majorFont = extractElements(themeXml, 'a:majorFont')[0] || '';
  const minorFont = extractElements(themeXml, 'a:minorFont')[0] || '';
  const majorLatin = majorFont.match(/<a:latin\b([^>]*)\/>/);
  const minorLatin = minorFont.match(/<a:latin\b([^>]*)\/>/);

  return {
    name: themeName,
    colorSchemeName: getAttr(extractOpeningTag(clrScheme), 'name'),
    colors,
    fonts: {
      majorLatin: majorLatin ? getAttr(majorLatin[1], 'typeface') : null,
      minorLatin: minorLatin ? getAttr(minorLatin[1], 'typeface') : null,
    },
  };
}

async function extractTemplate(inputPath, outputJsonPath, mediaOutDir) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input PPTX file not found: ${inputPath}`);
  }

  const buffer = fs.readFileSync(inputPath);
  const zip = await JSZip.loadAsync(buffer);

  const readText = async (entryPath) => {
    const f = zip.file(entryPath);
    return f ? f.async('string') : null;
  };

  // 1. Presentation dimensions & slide order
  const presXml = await readText('ppt/presentation.xml');
  const presRels = parseRels(await readText('ppt/_rels/presentation.xml.rels'));
  const sldSzMatch = presXml.match(/<p:sldSz\b([^>]*)\/>/);
  const notesSzMatch = presXml.match(/<p:notesSz\b([^>]*)\/>/);

  const slideOrder = [];
  const sldIdMatches = presXml.matchAll(/<p:sldId\b([^>]*)\/>/g);
  for (const m of sldIdMatches) {
    const id = getAttr(m[1], 'id');
    const rId = getAttr(m[1], 'r:id');
    const rel = presRels[rId];
    if (rel) {
      slideOrder.push({ id, rId, target: `ppt/${rel.target.replace(/^\/+/, '')}` });
    }
  }

  // 2. Theme
  const theme1 = parseTheme(await readText('ppt/theme/theme1.xml'));

  // 3. Slide Master
  const masterXml = await readText('ppt/slideMasters/slideMaster1.xml');
  const masterRels = parseRels(await readText('ppt/slideMasters/_rels/slideMaster1.xml.rels'));
  const masterBg = extractElements(masterXml || '', 'p:bg')[0];
  const masterSpTree = extractElements(masterXml || '', 'p:spTree')[0];
  const masterTxStyles = extractElements(masterXml || '', 'p:txStyles')[0];

  const parseStyleBlock = (tag) => {
    const block = extractElements(masterTxStyles || '', tag)[0];
    if (!block) return null;
    const levels = {};
    for (let lvl = 1; lvl <= 5; lvl++) {
      const lEl = extractElements(block, `a:lvl${lvl}pPr`)[0];
      if (lEl) levels[`lvl${lvl}`] = parsePPr(lEl);
    }
    return levels;
  };

  // 4. Slide Layouts
  const layoutEntries = Object.keys(zip.files)
    .filter((k) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));

  const slideLayouts = [];
  for (const layoutPath of layoutEntries) {
    const layoutXml = await readText(layoutPath);
    const relsPath = layoutPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels';
    const layoutRels = parseRels(await readText(relsPath));
    const cSld = layoutXml.match(/<p:cSld\b([^>]*)/);
    const spTree = extractElements(layoutXml, 'p:spTree')[0];
    slideLayouts.push({
      path: layoutPath,
      name: cSld ? getAttr(cSld[1], 'name') : path.basename(layoutPath),
      elements: parseSpTree(spTree, layoutRels),
    });
  }

  // 5. Slides
  const slides = [];
  for (let i = 0; i < slideOrder.length; i++) {
    const slideMeta = slideOrder[i];
    const slideXml = await readText(slideMeta.target);
    const relsPath = slideMeta.target.replace('slides/', 'slides/_rels/') + '.rels';
    const slideRels = parseRels(await readText(relsPath));
    const layoutRel = Object.values(slideRels).find((r) => r.type === 'slideLayout');
    const bg = extractElements(slideXml || '', 'p:bg')[0];
    const spTree = extractElements(slideXml || '', 'p:spTree')[0];

    slides.push({
      slideNumber: i + 1,
      path: slideMeta.target,
      layoutTarget: layoutRel ? layoutRel.target : null,
      background: bg ? parseColor(bg) : null,
      elements: parseSpTree(spTree, slideRels),
    });
  }

  // 6. Extract all embedded media assets
  fs.mkdirSync(mediaOutDir, { recursive: true });
  const mediaEntries = Object.keys(zip.files).filter((k) => k.startsWith('ppt/media/') && !zip.files[k].dir);
  const extractedMedia = [];
  for (const mPath of mediaEntries) {
    const data = await zip.file(mPath).async('nodebuffer');
    const filename = path.basename(mPath);
    const dest = path.join(mediaOutDir, filename);
    fs.writeFileSync(dest, data);
    extractedMedia.push({
      ooxmlPath: mPath,
      extractedPath: path.relative(REPO_ROOT, dest).replace(/\\/g, '/'),
      bytes: data.length,
    });
  }

  const blueprint = {
    extractedAt: new Date().toISOString(),
    sourceFile: path.relative(REPO_ROOT, inputPath).replace(/\\/g, '/'),
    slideSize: {
      cx: sldSzMatch ? emuToUnits(getAttr(sldSzMatch[1], 'cx')) : null,
      cy: sldSzMatch ? emuToUnits(getAttr(sldSzMatch[1], 'cy')) : null,
      type: sldSzMatch ? getAttr(sldSzMatch[1], 'type') : null,
    },
    notesSize: {
      cx: notesSzMatch ? emuToUnits(getAttr(notesSzMatch[1], 'cx')) : null,
      cy: notesSzMatch ? emuToUnits(getAttr(notesSzMatch[1], 'cy')) : null,
    },
    theme: theme1,
    slideMaster: {
      background: masterBg ? parseColor(masterBg) : null,
      elements: parseSpTree(masterSpTree, masterRels),
      textStyles: {
        titleStyle: parseStyleBlock('p:titleStyle'),
        bodyStyle: parseStyleBlock('p:bodyStyle'),
        otherStyle: parseStyleBlock('p:otherStyle'),
      },
    },
    slideLayouts,
    slides,
    media: extractedMedia,
  };

  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, JSON.stringify(blueprint, null, 2), 'utf8');

  // Print concise human-readable summary
  console.log('=== PPTX Template Formatting Extraction Complete ===');
  console.log(`Source:        ${blueprint.sourceFile}`);
  console.log(`Slide Size:    ${blueprint.slideSize.cx?.inches}" x ${blueprint.slideSize.cy?.inches}" (${blueprint.slideSize.cx?.emu} x ${blueprint.slideSize.cy?.emu} EMU)`);
  console.log(`Theme:         ${blueprint.theme?.name} (Major: ${blueprint.theme?.fonts?.majorLatin}, Minor: ${blueprint.theme?.fonts?.minorLatin})`);
  console.log(`Theme Colors:  dk1=${blueprint.theme?.colors?.dk1?.lastClr || blueprint.theme?.colors?.dk1?.hex}, lt1=${blueprint.theme?.colors?.lt1?.lastClr || blueprint.theme?.colors?.lt1?.hex}, accent1=${blueprint.theme?.colors?.accent1?.hex}, accent2=${blueprint.theme?.colors?.accent2?.hex}`);
  console.log(`Layouts:       ${blueprint.slideLayouts.length}`);
  console.log(`Slides:        ${blueprint.slides.length}`);
  console.log(`Media Assets:  ${blueprint.media.map((m) => `${path.basename(m.ooxmlPath)} (${m.bytes}B)`).join(', ')}`);
  console.log(`Output JSON:   ${path.relative(REPO_ROOT, outputJsonPath).replace(/\\/g, '/')}`);
}

const defaultInput = path.join(REPO_ROOT, 'docs/presentation/template/FYP_Proposal_Defense_Template.pptx');
const defaultOutput = path.join(REPO_ROOT, 'docs/presentation/extracted_template_format.json');
const defaultMediaDir = path.join(REPO_ROOT, 'docs/presentation/extracted_media');

const inputArg = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;
const outputArg = process.argv[3] ? path.resolve(process.argv[3]) : defaultOutput;

extractTemplate(inputArg, outputArg, defaultMediaDir).catch((err) => {
  console.error('Extraction failed:', err);
  process.exit(1);
});
