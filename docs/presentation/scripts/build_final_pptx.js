#!/usr/bin/env node
/**
 * @file build_final_pptx.js
 * @description Generates the final CollabIDE FYP PowerPoint presentation (.pptx)
 * by precisely replicating the extracted OOXML template formatting from
 * docs/presentation/template/FYP_Proposal_Defense_Template.pptx (same slide master,
 * layouts, theme colors, Bahria University logo, dimensions, fonts, margins, and
 * table styling).
 *
 * Incorporates:
 *   - Phase 1 SRS (docs/02_requirements/CollabIDE-Requirements.md)
 *   - Phase 2 Exhaustive System Design Requirements (SRS v2.0 PDF)
 *   - Full work done to date across all 3 team members (tracked from GitHub)
 *   - 7 high-DPI UML & Scrumban diagrams (docs/presentation/diagrams/*.png)
 *   - Scrumban Epics, User Stories & Tasks from Jira CSV + Excel workbook
 *
 * Usage:
 *   node docs/presentation/scripts/build_final_pptx.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const JSZip = require(path.join(REPO_ROOT, 'frontend/node_modules/jszip'));

const TEMPLATE_PPTX = path.join(REPO_ROOT, 'docs/presentation/template/FYP_Proposal_Defense_Template.pptx');
const BLUEPRINT_JSON = path.join(REPO_ROOT, 'docs/presentation/extracted_template_format.json');
const DIAGRAMS_DIR = path.join(REPO_ROOT, 'docs/presentation/diagrams');
const OUTPUT_PPTX = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(REPO_ROOT, 'docs/presentation/CollabIDE_Final_Presentation.pptx');

function xmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds an OOXML <a:p> paragraph matching the template's exact Arial run formatting.
 * @param {object} p
 * @param {Array<{text:string, bold?:boolean, italic?:boolean, color?:string, sz?:number}>} p.runs
 * @param {number} [p.lvl=0]
 * @param {boolean} [p.bullet=false]
 * @param {boolean} [p.numbered=false]
 * @param {number} [p.sz=20] Font size in pt
 * @param {number} [p.spcBef=0] Space before in pt
 * @param {number} [p.spcAft=4] Space after in pt
 * @param {string} [p.align='l']
 */
function buildParagraph(p) {
  const lvl = p.lvl || 0;
  const defSz = Math.round((p.sz || 20) * 100);
  const algnAttr = p.align ? ` algn="${p.align}"` : '';
  const lvlAttr = lvl > 0 ? ` lvl="${lvl}"` : '';
  const marL = p.bullet || p.numbered ? (lvl > 0 ? 457200 : 285750) : 0;
  const indent = p.bullet || p.numbered ? -228600 : 0;
  const marAttr = marL ? ` marL="${marL}" indent="${indent}"` : '';

  let buXml = '<a:buNone/>';
  if (p.numbered) {
    buXml = '<a:buFont typeface="Arial"/><a:buAutoNum type="arabicPeriod"/>';
  } else if (p.bullet) {
    const ch = lvl > 0 ? '–' : '•';
    buXml = `<a:buFont typeface="Arial"/><a:buChar char="${xmlEsc(ch)}"/>`;
  }

  const spcBefXml = p.spcBef ? `<a:spcBef><a:spcPts val="${Math.round(p.spcBef * 100)}"/></a:spcBef>` : '';
  const spcAftXml = p.spcAft !== undefined ? `<a:spcAft><a:spcPts val="${Math.round(p.spcAft * 100)}"/></a:spcAft>` : '';

  const runsXml = (p.runs || []).map((r) => {
    const rSz = r.sz ? Math.round(r.sz * 100) : defSz;
    const bAttr = r.bold ? ' b="1"' : ' b="0"';
    const iAttr = r.italic ? ' i="1"' : '';
    const clrXml = r.color
      ? `<a:solidFill><a:srgbClr val="${r.color.replace('#', '')}"/></a:solidFill>`
      : '<a:solidFill><a:srgbClr val="111827"/></a:solidFill>';
    return `<a:r><a:rPr lang="en-US" sz="${rSz}"${bAttr}${iAttr} dirty="0">${clrXml}<a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(r.text)}</a:t></a:r>`;
  }).join('');

  return `<a:p><a:pPr${algnAttr}${lvlAttr}${marAttr}>${spcBefXml}${spcAftXml}${buXml}</a:pPr>${runsXml}<a:endParaRPr lang="en-US" sz="${defSz}" dirty="0"><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:endParaRPr></a:p>`;
}

/**
 * Builds a standard Title + Content slide using slideLayout2.xml (exact template layout).
 */
function buildContentSlideXml(titleText, paragraphs, opts = {}) {
  const x = opts.x ?? 182880;       // 0.20 in
  const y = opts.y ?? 1325880;      // 1.45 in (cleanly below template Title Placeholder 1)
  const cx = opts.cx ?? 8778240;    // 9.60 in
  const cy = opts.cy ?? 5303520;    // 5.80 in (cleanly above bottom chrome)

  const pXml = paragraphs.map(buildParagraph).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(titleText)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="t"><a:normAutofit/></a:bodyPr>
          <a:lstStyle/>
          ${pXml}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

/**
 * Builds a Title + Full-Bleed Diagram slide (exact 5:3 aspect ratio matching 1600x960 PNGs).
 */
function buildDiagramSlideXml(titleText, captionText, imageRelId) {
  // 9.40" x 5.64" centered horizontally on 10" x 7.5" slide
  const picX = 274320;    // 0.30 in
  const picY = 1234440;   // 1.35 in
  const picCx = 8595360;  // 9.40 in
  const picCy = 5157216;  // 5.64 in

  const captionShape = captionText
    ? `<p:sp>
        <p:nvSpPr><p:cNvPr id="4" name="Caption Box"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="274320" y="6431280"/><a:ext cx="8595360" cy="320040"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr lIns="45720" tIns="18288" rIns="45720" bIns="18288" anchor="ctr"/><a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1250" i="1" dirty="0"><a:solidFill><a:srgbClr val="475569"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(captionText)}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(titleText)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="3" name="UML Diagram"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="${imageRelId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="${picX}" y="${picY}"/><a:ext cx="${picCx}" cy="${picCy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
      ${captionShape}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

/**
 * Builds a Title + Clean Structured Table slide matching Bahria Navy header styling.
 */
function buildTableSlideXml(titleText, subtitleText, headers, rows, colWidthsEmu, rowHeightEmu = 430000, fontSizePt = 13.5) {
  const totalW = colWidthsEmu.reduce((a, b) => a + b, 0);
  const startX = Math.round((9144000 - totalW) / 2);
  const startY = subtitleText ? 1720000 : 1400000;
  const totalH = (rows.length + 1) * rowHeightEmu;
  const sz = Math.round(fontSizePt * 100);
  const hSz = Math.round((fontSizePt + 0.5) * 100);

  const gridColsXml = colWidthsEmu.map((w) => `<a:gridCol w="${w}"/>`).join('');

  const borderXml = (clr = 'CBD5E1') => `
    <a:lnL w="9525"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill></a:lnL>
    <a:lnR w="9525"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill></a:lnR>
    <a:lnT w="9525"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill></a:lnT>
    <a:lnB w="9525"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill></a:lnB>`;

  const makeRow = (cells, isHeader, rowIdx) => {
    const fillHex = isHeader ? '404096' : (rowIdx % 2 === 0 ? 'FFFFFF' : 'F8FAFC');
    const txtHex = isHeader ? 'FFFFFF' : '1E293B';
    const bFlag = isHeader ? '1' : '0';
    const curSz = isHeader ? hSz : sz;
    const hEmu = isHeader ? Math.round(rowHeightEmu * 0.92) : rowHeightEmu;

    const cellsXml = cells.map((cellVal, cIdx) => {
      const boldCell = isHeader || cIdx === 0 ? '1' : bFlag;
      const align = isHeader ? 'ctr' : 'l';
      const lines = String(cellVal ?? '').split('\n');
      const parasXml = lines.map((line, lIdx) => {
        const lineBold = isHeader || (cIdx === 0 && lIdx === 0) ? '1' : '0';
        return `<a:p><a:pPr algn="${align}"><a:spcAft><a:spcPts val="200"/></a:spcAft></a:pPr><a:r><a:rPr lang="en-US" sz="${curSz}" b="${lineBold}" dirty="0"><a:solidFill><a:srgbClr val="${txtHex}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(line)}</a:t></a:r></a:p>`;
      }).join('');
      return `<a:tc>
        <a:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          ${parasXml}
        </a:txBody>
        <a:tcPr marL="76200" marR="76200" marT="45720" marB="45720" anchor="ctr">
          ${borderXml(isHeader ? '404096' : 'CBD5E1')}
          <a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill>
        </a:tcPr>
      </a:tc>`;
    }).join('');
    return `<a:tr h="${hEmu}">${cellsXml}</a:tr>`;
  };

  const rowsXml = makeRow(headers, true, 0) + rows.map((r, i) => makeRow(r, false, i)).join('');

  const subXml = subtitleText
    ? `<p:sp>
        <p:nvSpPr><p:cNvPr id="4" name="Subtitle Box"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="${startX}" y="1280000"/><a:ext cx="${totalW}" cy="380000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr lIns="45720" tIns="18288" rIns="45720" bIns="18288" anchor="ctr"/><a:lstStyle/>
          <a:p><a:r><a:rPr lang="en-US" sz="1550" dirty="0"><a:solidFill><a:srgbClr val="475569"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(subtitleText)}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(titleText)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      ${subXml}
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="3" name="Data Table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="${startX}" y="${startY}"/><a:ext cx="${totalW}" cy="${totalH}"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tblPr firstRow="1" bandRow="1"/>
              <a:tblGrid>${gridColsXml}</a:tblGrid>
              ${rowsXml}
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

/**
 * Builds a high-clarity Competitor Comparison Table slide with color-coded status cells
 * (green ✔, red ✘, amber Partial/Limited) and a subtly highlighted CollabIDE column.
 */
function buildComparisonTableSlideXml(titleText, headers, rows, colWidthsEmu) {
  const totalW = colWidthsEmu.reduce((a, b) => a + b, 0);
  const startX = Math.round((9144000 - totalW) / 2);
  const startY = 1280000;
  const headerH = 440000;
  const rowH = 365000;
  const totalH = headerH + rows.length * rowH;

  const gridColsXml = colWidthsEmu.map((w) => `<a:gridCol w="${w}"/>`).join('');

  const borderXml = (clr = 'CBD5E1') => `
    <a:lnL w="9525"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill></a:lnL>
    <a:lnR w="9525"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill></a:lnR>
    <a:lnT w="9525"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill></a:lnT>
    <a:lnB w="9525"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill></a:lnB>`;

  const makeCell = (text, opts) => {
    const { fillHex, txtHex, bold, szPt, align, borderClr } = opts;
    const sz = Math.round(szPt * 100);
    const lines = String(text ?? '').split('\n');
    const parasXml = lines.map((line) => (
      `<a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="${sz}" b="${bold ? '1' : '0'}" dirty="0"><a:solidFill><a:srgbClr val="${txtHex}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(line)}</a:t></a:r></a:p>`
    )).join('');
    return `<a:tc>
      <a:txBody><a:bodyPr/><a:lstStyle/>${parasXml}</a:txBody>
      <a:tcPr marL="54864" marR="54864" marT="27432" marB="27432" anchor="ctr">
        ${borderXml(borderClr || 'CBD5E1')}
        <a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill>
      </a:tcPr>
    </a:tc>`;
  };

  const headerRowXml = `<a:tr h="${headerH}">${headers.map((h, cIdx) => makeCell(h, {
    fillHex: cIdx === 1 ? '1E3A8A' : '404096',
    txtHex: 'FFFFFF',
    bold: true,
    szPt: 11,
    align: cIdx === 0 ? 'l' : 'ctr',
    borderClr: '404096',
  })).join('')}</a:tr>`;

  const bodyRowsXml = rows.map((r, rIdx) => {
    const baseFill = rIdx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
    return `<a:tr h="${rowH}">${r.map((val, cIdx) => {
      const s = String(val ?? '');
      let txtHex = '1E293B';
      let bold = cIdx === 0;
      let szPt = 10.5;
      let fillHex = cIdx === 1 ? (rIdx % 2 === 0 ? 'EFF6FF' : 'E0F2FE') : baseFill;

      if (cIdx > 0) {
        if (s.startsWith('✔')) {
          txtHex = '16A34A';
          bold = true;
          szPt = s.length > 2 ? 9.5 : 12.5;
        } else if (s.startsWith('✘')) {
          txtHex = 'DC2626';
          bold = true;
          szPt = s.length > 2 ? 9.5 : 12;
        } else if (/^(Partial|Limited)/i.test(s)) {
          txtHex = 'B45309';
          bold = true;
          szPt = 10;
        }
      }

      return makeCell(s, {
        fillHex,
        txtHex,
        bold,
        szPt,
        align: cIdx === 0 ? 'l' : 'ctr',
      });
    }).join('')}</a:tr>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${xmlEsc(titleText)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="3" name="Competitor Comparison Table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="${startX}" y="${startY}"/><a:ext cx="${totalW}" cy="${totalH}"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tblPr firstRow="1" bandRow="1"/>
              <a:tblGrid>${gridColsXml}</a:tblGrid>
              ${headerRowXml}
              ${bodyRowsXml}
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function headingP(text, sz = 22, spcBef = 8) {
  return { runs: [{ text, bold: true, color: '404096' }], sz, spcBef, spcAft: 4 };
}

function bulletP(lead, rest, sz = 19, lvl = 0) {
  const runs = [];
  if (lead) runs.push({ text: lead, bold: true, color: '0F172A' });
  if (rest) runs.push({ text: rest, bold: false, color: '1E293B' });
  return { runs, bullet: true, lvl, sz, spcBef: 2, spcAft: 5 };
}

function plainP(text, sz = 20, spcBef = 4, italic = false) {
  return { runs: [{ text, italic, color: '1E293B' }], sz, spcBef, spcAft: 6 };
}

async function main() {
  if (!fs.existsSync(TEMPLATE_PPTX)) {
    throw new Error(`Template PPTX not found: ${TEMPLATE_PPTX}`);
  }
  if (!fs.existsSync(BLUEPRINT_JSON)) {
    throw new Error(`Blueprint JSON not found. Run extract_pptx_format.js first: ${BLUEPRINT_JSON}`);
  }

  const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_JSON, 'utf8'));
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE_PPTX));

  // Preserve exact Slide 1 XML (Bahria University logo layout, exact Group Members table, Supervisor)
  // Updating only the cover title text to reflect Progress & Architecture Defense + CollabIDE
  let slide1Xml = await zip.file('ppt/slides/slide1.xml').async('string');
  slide1Xml = slide1Xml
    .replace('>FYP Proposal Defense<', '>FYP Progress &amp; Architecture Defense<')
    .replace('>COLLIDE<', '>CollabIDE<');

  // Remove old slides, slide rels, and old unused content images (keep image1.png which is Bahria logo!)
  for (const key of Object.keys(zip.files)) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(key)) zip.remove(key);
    if (/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(key)) zip.remove(key);
    if (key === 'ppt/media/image2.png' || key === 'ppt/media/image3.jpeg') zip.remove(key);
  }

  // Define all 22 slides in logical FYP defense flow
  const slideDefs = [
    // 1. Cover Slide (exact Slide 1 clone)
    {
      layout: '../slideLayouts/slideLayout1.xml',
      rawXml: slide1Xml,
    },

    // 2. Table of Contents
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Table of Contents', [
        { runs: [{ text: 'Introduction, Background & Competitor Comparison' }], numbered: true, sz: 22, spcAft: 7 },
        { runs: [{ text: 'Problem Statement & Target Stakeholders' }], numbered: true, sz: 22, spcAft: 7 },
        { runs: [{ text: 'Proposed Solution, Tech Stack & SDG Mapping' }], numbered: true, sz: 22, spcAft: 7 },
        { runs: [{ text: 'Project Scope — Phase 1 SRS v1.2 & Phase 2 SRS v2.0' }], numbered: true, sz: 22, spcAft: 7 },
        { runs: [{ text: 'Work Completed Until Now (Full Team GitHub Progress)' }], numbered: true, sz: 22, spcAft: 7 },
        { runs: [{ text: 'Phase 2 Enterprise Scale Strategy (Dual-Profile 100k Architecture)' }], numbered: true, sz: 22, spcAft: 7 },
        { runs: [{ text: 'Exhaustive UML Diagrams (Use Case, Architecture, Class & Sequences)' }], numbered: true, sz: 22, spcAft: 7 },
        { runs: [{ text: 'Scrumban Breakdown (Epics, User Stories, Tasks & Jira Excel)' }], numbered: true, sz: 22, spcAft: 7 },
        { runs: [{ text: 'Verification, Automated Test Suites & References' }], numbered: true, sz: 22, spcAft: 7 },
      ]),
    },

    // 3. Introduction
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Introduction', [
        plainP('CollabIDE is a zero-install, browser-based collaborative coding platform unifying real-time CRDT editing, dynamic Room Leader access control, native WebRTC voice, and sandboxed code execution:', 21, 4),
        bulletP('Conflict-Free Real-Time Sync: ', 'Yjs CRDT + Monaco Editor guarantee eventual consistency across simultaneous multi-file edits.', 20),
        bulletP('Dynamic Room Leader RBAC: ', 'Instructors and Owners grant/revoke Editor permissions and voice controls live without reconnects.', 20),
        bulletP('Unified Collaboration: ', 'Eliminates fragmented workflows (Zoom + VS Code Live Share + GitHub) in a single persistent workspace.', 20),
        bulletP('Enterprise Evolution (Phase 2 SRS v2.0): ', 'Architected around Dual-Profile deployment—Hetzner single-VM demo (<4GB RAM) and AWS EKS 100k-concurrency benchmark (P99 < 50ms).', 20),
      ]),
    },

    // 4. Background & Competitive Landscape
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Background', [
        headingP('Current Cloud Platforms', 22, 4),
        bulletP('Replit / CodeSandbox / GitHub Codespaces → ', 'Browser-based collaborative IDEs with cloud containers.', 19),
        bulletP('Limitations: ', 'No built-in voice chat, no live instructor Room Leader access control, or not freely self-hostable.', 18, 1),
        headingP('Installed / Desktop Tools', 22, 10),
        bulletP('VS Code Live Share & Zed Editor → ', 'IDE extension or native desktop collaborative editor.', 19),
        bulletP('Limitations: ', 'Live Share Audio was deprecated in 2022; Zed requires desktop installation and lacks browser zero-install access.', 18, 1),
        headingP('The Engineering Need', 22, 10),
        bulletP('Gap Closed by CollabIDE: ', 'A single open-source, self-hostable, zero-install platform combining CRDT editing, native DTLS-SRTP voice, RBAC access control, and scalable sandbox execution.', 19),
      ]),
    },

    // 5. Competitor Comparison Table
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildComparisonTableSlideXml(
        'Competitor Comparison',
        ['Feature', 'CollabIDE', 'Replit', 'CodeSandbox', 'VS Code\nLive Share', 'Zed', 'GitHub\nCodespaces'],
        [
          ['Zero install (browser-only)', '✔', '✔', '✔', '✘', '✘', 'Partial'],
          ['Real-time collaborative editing', '✔', '✔', '✔', '✔', '✔', '✔'],
          ['CRDT-based (conflict-free)', '✔', '✔', '✔', '✘ (OT)', '✔', '✘'],
          ['Built-in voice chat', '✔', '✘', '✘', '✘\n(deprecated)', '✔', '✘'],
          ['Code execution (multi-language)', '✔', '✔', 'Partial', '✔\n(host machine)', '✘', '✔'],
          ['Shared execution output', '✔', '✘', '✘', '✘', '✘', '✘'],
          ['Dynamic role / access control', '✔', '✘', '✘', 'Limited', '✘', 'Limited'],
          ['Room Leader with live controls', '✔', '✘', '✘', '✘', '✘', '✘'],
          ['Persistent sessions (no host)', '✔', '✔', '✔', '✘', '✘', '✔'],
          ['Self-hostable', '✔', '✘', '✘', '✘', '✘', '✘'],
          ['Free to operate', '✔', '✘', '✘', '✔', '✔', 'Partial'],
          ['No account required for guests', '✘', '✘', '✘', '✘', '✘', '✘'],
          ['Academic / instructor use case', '✔', 'Partial', '✘', 'Partial', '✘', '✘'],
        ],
        [2480000, 1020000, 860000, 1150000, 1250000, 800000, 1220000]
      ),
    },

    // 5. Problem Statement
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Problem Statement', [
        headingP('Challenges in Collaborative Coding Today', 21, 2),
        bulletP('Fragmented Tool Stack: ', 'Teams juggle Zoom/Discord, Live Share, and GitHub—creating constant context-switching.', 18),
        bulletP('No Structured Access Control: ', 'In live university labs, unrestricted editors let any participant overwrite code mid-demo.', 18),
        bulletP('No Shared Execution & Scale Bottlenecks: ', 'Stdout is hidden behind screen shares; naive WS servers collapse under reconnect storms ("thundering herd").', 18),
        headingP('Key Stakeholders Served', 21, 10),
        bulletP('Students: ', 'Zero-install browser workspace with persistent sessions, multi-file editing, chat, and voice.', 18),
        bulletP('Instructors & Lab Supervisors: ', 'Room Leader grant/revoke controls, hard mute, and live visibility without screen sharing.', 18),
        bulletP('Small Dev Teams & Bootcamps: ', 'Self-hostable infrastructure with snapshots, Git/LSP roadmap, and horizontal scaling readiness.', 18),
      ]),
    },

    // 6. Proposed Solution & Tech Stack
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Proposed Solution & Tech Stack', [
        headingP('Phase 1 Production Stack (Implemented & Deployed)', 21, 2),
        bulletP('Frontend: ', 'React 19 + Vite, Monaco Editor, y-monaco, y-websocket, native WebRTC + Socket.IO client.', 18),
        bulletP('Backend: ', 'Node.js + Express (6 independent modules, NFR-48), PM2 Cluster Mode (NFR-32), Helmet (NFR-28).', 18),
        bulletP('Security & Data: ', 'RS256 JWT + Bcrypt RTR, AES-256-GCM + HMAC blind indexes, MongoDB Atlas (pool 5–20), Nginx TLS, Coturn STUN/TURN, Judge0 CE.', 18),
        headingP('Phase 2 Enterprise Cloud IDE Stack (SRS v2.0)', 21, 10),
        bulletP('Ingress & Scale: ', 'AWS NLB (L4) + Envoy Fleet Consistent Ring-Hashing (?roomId=), Off-Hot-Path Sharded Redis, AWS EKS + HPA.', 18),
        bulletP('Cloud IDE Capabilities: ', 'BullMQ + cgroup sandbox workers, xterm.js + node-pty shell, Monaco LSP (TS/Pyright), GitHub OAuth & Diff UI.', 18),
        bulletP('Telemetry & Load Verification: ', 'Distributed k6 (100k VUs), Prometheus /metrics, and Grafana P99 latency heatmaps.', 18),
      ]),
    },

    // 7. SDG Mapping
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Proposed Solution — SDG Mappings', [
        headingP('Sustainable Development Goals Alignment', 22, 4),
        headingP('SDG 4 — Quality Education', 21, 12),
        bulletP('Equitable Zero-Install Access: ', 'Removes licensing fees and heavy local setup barriers for university programming labs, pair programming, and supervised coding assessments.', 19),
        bulletP('Instructor-Led Pedagogy: ', 'Room Leader live edit controls, hard mute, and shared execution output empower interactive live coding lectures.', 19),
        headingP('SDG 9 — Industry, Innovation, and Infrastructure', 21, 12),
        bulletP('Resilient Distributed Architecture: ', 'Combines CRDT sync, server-authoritative YjsUpdateGuard, native WebRTC mesh, and Envoy Ring-Hash / Control-Data Plane separation.', 19),
        bulletP('Open-Source & Self-Hostable: ', 'Dual-profile blueprint runs equally on a $15/mo academic VM (Docker Compose) or 100k-user Kubernetes clusters.', 19),
      ]),
    },

    // 8. Project Scope (Phase 1 SRS v1.2 + Phase 2 SRS v2.0)
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildTableSlideXml(
        'Project Scope — Phase 1 (SRS v1.2) & Phase 2 (SRS v2.0)',
        'Complete functional, non-functional, and system-design scope aligned with ISO/IEC/IEEE 29148:2018.',
        ['Domain', 'Phase 1 Scope (SRS v1.2)', 'Phase 2 Scope (SRS v2.0)', 'Current Status'],
        [
          ['Auth & Security', 'FR-01–09, NFR-11–28: RS256 JWT, RTR, CSRF, Lockout, AES-256-GCM, Helmet', 'SDR-01: Control/Data Plane Split & 60s RS256 WS Tickets (0 DB reads)', 'Phase 1 Done / PR;\nSDR-01 Foundation PR'],
          ['Collaboration & Roles', 'FR-10–26, 34–44, 54–57: Yjs Multi-File, Room Leader RBAC, Chat, Snapshots', 'NFR-56, NFR-58–59: Virtualized 50k Tree, Pure Binary Backpressure, 10s Flush', 'Phase 1 Done / PR;\nPhase 2 Backlog'],
          ['Execution & Cloud IDE', 'FR-27–33, NFR-26/43: Judge0 (5 Langs + STDIN), 15s Timeout, HTML Iframe', 'SDR-05, FR-58–62: BullMQ Runner, GitHub Clone, xterm PTY, LSP, Git Diff, Preview', 'Phase 1 Done;\nPhase 2 Backlog'],
          ['Voice & Presence', 'FR-45–53, NFR-06/10/29–31/44: Native WebRTC Mesh, Coturn, 3x ICE Restart', 'NFR-61: Decorrelated Jitter Reconnect & PreStop Staged Drainage', 'Phase 1 Done;\nPhase 2 Backlog'],
          ['Infra & 100k Scale', 'NFR-32–42, 48–55: PM2, Nginx TLS, Pooling, Shutdown, Pub/Sub, 6 Modules', 'SDR-02–04, NFR-60/62: Envoy Ring-Hash, AWS EKS+NLB, C100K Kernel, k6+Grafana', 'Phase 1 Done;\nPhase 2 Backlog'],
        ],
        [1650000, 2750000, 2900000, 1480000],
        780000,
        12.5
      ),
    },

    // 9. Out of Scope & Key Risks
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Project Scope — Out of Scope & Risks', [
        headingP('Explicitly Out of Scope', 21, 2),
        bulletP('Mobile Native Apps (iOS / Android): ', 'Desktop/laptop browser-only (1280×720px minimum layout enforced via NFR-55).', 18),
        bulletP('Video Chat, Screen Sharing & Audio Recording: ', 'Audio-only P2P DTLS-SRTP; zero server-side voice storage (NFR-31).', 18),
        bulletP('Offline-First / PWA Mode: ', 'Requires live network sync; temporary drops recover via exponential backoff & state-vector diff.', 18),
        headingP('Key Risks & Implemented Mitigations', 21, 10),
        bulletP('University Network Blocking WebRTC UDP: ', 'Mitigated via Coturn TURN relay fallback over TCP port 443 with 1h HMAC credentials.', 18),
        bulletP('Judge0 API Quotas or Hung Sockets: ', 'Mitigated via 10 runs/min user limiter, 15s AbortSignal fuse, and self-hosted Docker Judge0 fallback.', 18),
        bulletP('Reconnect Storms & Race Conditions: ', 'Mitigated via atomic MongoDB updates, 20 WS/room cap, and Phase 2 60s RS256 tickets + jittered drainage.', 18),
      ]),
    },

    // 10. Work Completed Until Now (Overall Summary)
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Work Completed Until Now — Project Status', [
        headingP('Repository & Delivery Milestones (Tracked via GitHub)', 21, 2),
        bulletP('220+ Total Commits Delivered: ', '219 commits merged on origin/main plus 3 completed feature PR branches awaiting final reconciliation.', 18),
        bulletP('Phase 1 Requirements Coverage: ', '108 / 112 Jira Phase 1 User Stories implemented on main; remaining 4 stories (FR-09, FR-37, FR-38, NFR-28) + SDR-01 foundation completed on active PR branches.', 18),
        bulletP('Live Production Cloud Deployment: ', 'React SPA live on Vercel, Node.js backend live on Render, MongoDB Atlas connection pool active, plus full Docker Compose + Nginx TLS stack.', 18),
        bulletP('Security & Resilience Hardening: ', 'Resolved NoSQL injection & concurrency races (9be43a8), added authoritative YjsUpdateGuard, AES-256-GCM field encryption, 0640 log redaction, and Helmet CSP.', 18),
        bulletP('Automated Verification: ', '20+ native phase-based NFR/FR test suites (300+ assertions covering brute-force races, PM2 SIGKILL recovery, graceful shutdown, and failover).', 18),
      ]),
    },

    // 11. Full Team Contributions Table (All 3 Members — Verified from github.com/omer9618/Collab-IDE/branches/all)
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildTableSlideXml(
        'Team Contributions — GitHub Branches Breakdown',
        'Verified across all 53 feature/fix/docs branches on github.com/omer9618/Collab-IDE/branches/all (+ main).',
        ['Team Member\n(GitHub Branches)', 'Key Branches & Implemented Modules', 'FR / NFR / SDR Ownership'],
        [
          [
            'Hamza Tanveer\n02-131232-122\n(23 Branches)',
            'Branches: auth-redesign-sso, feat/FR-14-room-listing-dashboard, FR-23/24/25, NFR-13/16/22/23/39/42/44–48/50–54, feat/FR-09-password-reset-suite, feat/SDR-01-shared-nothing-backend.\nScope: Google OAuth SSO, Room Dashboard, Language/Theme/Keybindings, 6-Module Backend, RTR, AES-256-GCM + Blind Index, 0640 Logs, /health, Stateless API, Pub/Sub Scaling, Cross-Browser, RS256 Reset Suite & SDR-01 Failover.',
            'FR-09 (Suite), FR-14, FR-23–25;\nNFR-13, 16, 22, 23, 39, 42, 44–48, 50–54;\nSDR-01',
          ],
          [
            'Omer Siddiqui\n02-131232-067\n(16 Branches +\nCore main)',
            'Branches: feat/fr37-fr38-workspace-snapshots-and-security, feat/NFR-10/11/12/21/33/35, feat/FR-07-active-sessions, feat/vscode-explorer, fix/session-data-loss, fix/ui-sidebars, fix-vercel-login, light/dark-mode fixes + core main.\nScope: Core Yjs CRDT & Multi-File IDE, Room Leader RBAC, Judge0+STDIN+15s fuse, WebRTC Voice Reconnect, Docker/Nginx & Rate Limits, DB Isolation (NFR-25), NoSQL/Concurrency Fixes, Snapshots + YjsUpdateGuard + Helmet.',
            'FR-01–07, 10–13, 15–22, 27–38, 39–57;\nNFR-01–12, 17–21, 24–28, 33, 35, 37, 43',
          ],
          [
            'Maaz Ahmed\n02-131232-109\n(14 Branches)',
            'Branches: feat/FR-08-user-profile, feat/FR-09-password-reset, feat/FR-26-font-size-adjustment, NFR-33-reverse-proxy-with-nginx-by-maaz, feat/NFR-14/15/32/36/38/40/41/49/55, docs/codebase-execution-flow.\nScope: Profile Drawer, Initial Password Reset, Font Size, PM2 Cluster & Log Rotation, Nginx TLS Reverse Proxy, Atomic Brute-Force Lockout, CSRF Double-Submit, Fail-Fast Env & Key Rotation, 1y Static Caching/.br/.gz, DB Pool, Graceful Shutdown, 20 WS Cap, 1280×720 Clamping & decision.md / flow.md.',
            'FR-08, FR-09 (Initial), FR-26;\nNFR-14, 15, 32–34, 36, 38, 40, 41, 49, 55;\nArch Docs',
          ],
        ],
        [1850000, 4950000, 1980000],
        1340000,
        11.2
      ),
    },

    // 12. Phase 2 Enterprise Scale Strategy (SRS v2.0)
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildTableSlideXml(
        'Phase 2 Evolution — Dual-Profile Scale Model (SRS v2.0)',
        'Identical application codebase parameterized via DEPLOYMENT_PROFILE, STORAGE_ENGINE, and ENVOY_ROUTING_MODE.',
        ['Dimension', 'Profile A — FYP Demo Profile', 'Profile B — 100k Benchmark Profile'],
        [
          ['Target Infrastructure', 'Single Hetzner Cloud VM (CPX31: 4 vCPU, 8GB RAM, ~$15/mo) or dev laptop', 'AWS EKS (v1.28+) on 10–12 EC2 Spot Instances (c6i/c6a.xlarge), <$5/hr run'],
          ['Orchestration & Ingress', 'Docker Compose (docker-compose.demo.yml), single Envoy container (<3.5GB RAM, <45s boot)', 'Helm Charts + HPA (websocket_active_connections), AWS NLB (L4) + Envoy Ring-Hash Fleet'],
          ['Concurrency & Auth', 'Zero-DB 60s RS256 WS tickets (SDR-01); single Realtime node', '40 Realtime Pods × ~2,500 conns = 100,000 concurrent stateful WS users'],
          ['Hot Path & Persistence', 'In-memory Y.Doc + 10s BulkWrite flusher + local_disk / MongoDB', 'Off-Hot-Path Redis Sharding (0 keystroke Redis ops); S3 + compacted snapshots'],
          ['Performance Target', 'Interactive PTY (<30ms), LSP hover (<100ms), 50k virtualized tree (<150ms)', 'P99 sync latency < 50ms for 30 min; kernel C100K tuning (nofile=1M, somaxconn=65k)'],
        ],
        [2000000, 3380000, 3400000],
        740000,
        12.5
      ),
    },

    // 13–18. Exhaustive UML Diagrams (6 UML Diagrams)
    {
      layout: '../slideLayouts/slideLayout2.xml',
      diagram: '01_uml_use_case_diagram.png',
      title: 'UML Use Case Diagram — Full System Scope',
      caption: 'Covers all human RBAC roles, external systems, implemented Phase 1 FRs (FR-01–57), and Phase 2 SRS v2.0 Cloud IDE extensions.',
    },
    {
      layout: '../slideLayouts/slideLayout2.xml',
      diagram: '02_uml_component_deployment_architecture.png',
      title: 'UML Component & Deployment Architecture',
      caption: 'Four-tier modular architecture connecting React/Yjs client, Nginx/Envoy edge, Control/Data Plane Node.js cluster, and persistence/sandbox tiers.',
    },
    {
      layout: '../slideLayouts/slideLayout2.xml',
      diagram: '03_uml_class_domain_model.png',
      title: 'UML Class & Domain Model Diagram',
      caption: 'Exact Mongoose schemas (User, RefreshToken, IpBlock, Room) alongside RoomManager, RoomSession, YjsUpdateGuard, and PubSubAdapter hierarchy.',
    },
    {
      layout: '../slideLayouts/slideLayout2.xml',
      diagram: '04_uml_sequence_auth_and_tickets.png',
      title: 'UML Sequence — Auth, Rotation & RS256 Tickets',
      caption: 'Illustrates atomic brute-force lockout, single-use refresh rotation with replay revocation, 30m RS256 reset links, and Phase 2 60s zero-DB tickets.',
    },
    {
      layout: '../slideLayouts/slideLayout2.xml',
      diagram: '05_uml_sequence_crdt_roles_snapshots.png',
      title: 'UML Sequence — CRDT Sync, Roles & Snapshots',
      caption: 'Shows YjsUpdateGuard Viewer read-only enforcement, 2s/10s max-wait MongoDB persistence, live atomic role swaps, and clean snapshot rollback.',
    },
    {
      layout: '../slideLayouts/slideLayout2.xml',
      diagram: '06_uml_sequence_execution_and_voice.png',
      title: 'UML Sequence — Code Execution & WebRTC Voice',
      caption: 'Details Judge0 Base64 execution (10s/128MB caps, 15s AbortSignal, non-blocking DB save) and zero-install DTLS-SRTP P2P voice with 3x ICE restart.',
    },

    // 19. Scrumban Breakdown Diagram (Replacing WBS / Gantt)
    {
      layout: '../slideLayouts/slideLayout2.xml',
      diagram: '07_scrumban_epics_stories_tasks_board.png',
      title: 'Scrumban Breakdown — Epics, Stories & Tasks',
      caption: 'Replaces static WBS/Gantt with pull-based Scrumban workflow synchronized with docs/04_status/jira_scrumban_import.csv and Excel tracker.',
    },

    // 20. Jira Scrumban Epics & Excel Workbook Summary Table
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildTableSlideXml(
        'Scrumban Jira Epics & Excel Backlog Summary',
        'Generated from docs/04_status/jira_scrumban_import.csv + SRS v2.0 into CollabIDE_Scrumban_Jira.xlsx (4 sheets).',
        ['Epic Name', 'Phase', 'Stories', 'Done', 'In PR', 'Backlog', 'Key Deliverable Tasks'],
        [
          ['Auth', 'Phase 1', '15', '14', '1', '0', 'RS256 JWT, Bcrypt RTR, Lockout, CSRF, FR-09 Reset PR'],
          ['Rooms & Roles', 'Phase 1', '31', '31', '0', '0', 'RBAC Live Grant/Revoke, WebRTC Voice, File CRUD, Chat'],
          ['Real-Time Editing', 'Phase 1', '13', '11', '2', '0', 'Yjs CRDT, Monaco, Themes/Fonts, FR-37/38 Snapshots PR'],
          ['Execution', 'Phase 1', '7', '7', '0', '0', 'Judge0 (5 Langs + STDIN), 15s Fuse, HTML/CSS Iframe'],
          ['Infrastructure & Security', 'Phase 1', '43', '42', '1', '0', 'PM2, Nginx TLS, AES-GCM, 0640 Logs, Helmet NFR-28 PR'],
          ['Modularization & Config', 'Phase 1', '3', '3', '0', '0', 'NFR-48 (6 Modules), NFR-49 Fail-Fast Env, NFR-50 JSDoc'],
          ['Distributed Scale (100k)', 'Phase 2', '4', '0', '1*', '3', 'SDR-01 Shared-Nothing PR + Tickets, Envoy Ring-Hash, EKS'],
          ['Cloud IDE & Sandbox', 'Phase 2', '3', '0', '0', '3', 'BullMQ cgroup Runner, GitHub Clone, xterm.js PTY'],
          ['Code Intelligence & Git', 'Phase 2', '3', '0', '0', '3', 'Monaco LSP (TS/Pyright), Visual Git Diff, Port Preview'],
          ['C100K & Observability', 'Phase 2', '6', '0', '0', '6', '50k Tree, Backpressure, Kernel Tuning, k6 + Grafana'],
        ],
        [2050000, 950000, 740000, 680000, 680000, 820000, 2860000],
        410000,
        11.5
      ),
    },

    // 21. Verification, Security & Automated Test Coverage
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('Verification & Automated Test Coverage', [
        headingP('Phase 1 Automated Integration & Security Suites (Verified)', 21, 2),
        bulletP('Brute-Force & Concurrency (test_nfr14_brute_force.js): ', '139 assertions including 30-request parallel race conditions, IP blocks, and sliding windows.', 18),
        bulletP('Config & Secret Hygiene (test_nfr49_env_config.js): ', '74 assertions validating fail-fast startup, CSPRNG keys, repo secret sweeps, and HKDF rotation.', 18),
        bulletP('Cluster & Lifecycle (test_nfr32 / test_nfr38 / test_nfr36): ', '65 PM2 SIGKILL/512MB tests, 24 graceful shutdown flush tests, and 21st-WS 1008 rejection.', 18),
        bulletP('PR Branch Suites: ', 'test_nfr28_security_headers.js (Helmet CSP/HSTS), test_fr09_password_reset.js (7-part RS256 single-use), test_sdr01_shared_nothing_backend.js (5-phase Pod A kill -> Pod B zero-loss failover).', 18),
        headingP('Phase 2 Verification Plan (SRS v2.0)', 21, 10),
        bulletP('3-Tier Scale Suite: ', 'Unit/Contract tests (RS256 tickets, state-vector diff), Docker Profile A integration (PTY, LSP, compaction), and Distributed k6 100k WebSocket benchmark with Grafana telemetry.', 18),
      ]),
    },

    // 22. References (exact Slide 15 Arial 14pt format)
    {
      layout: '../slideLayouts/slideLayout2.xml',
      xml: buildContentSlideXml('References', [
        headingP('A. Academic Publications & Standards', 15.5, 2),
        plainP('G. Oster, P. Urso, P. Molli, and A. Imine, "Data consistency for P2P collaborative editing," Proc. ACM CSCW, 2006, pp. 259–268.', 13.5, 1),
        plainP('M. Shapiro, N. Preguiça, C. Baquero, and M. Zawirski, "Conflict-free replicated data types," Proc. 13th Int. Conf. SSS, 2011, pp. 386–400.', 13.5, 1),
        plainP('ISO/IEC/IEEE 29148:2018 — Systems and Software Engineering — Life Cycle Processes — Requirements Engineering.', 13.5, 1),
        plainP('W3C WebRTC Working Group, "WebRTC 1.0: Real-Time Communication Between Browsers," W3C Recommendation, Jan. 2021.', 13.5, 1),
        plainP('M. B. Jones et al., "JSON Web Token (JWT)," IETF RFC 7519, May 2015; H. Krawczyk & P. Eronen, "HKDF," IETF RFC 5869, May 2010.', 13.5, 1),
        headingP('B. Core Frameworks, Tools & Infrastructure', 15.5, 6),
        plainP('Yjs Project (yjs, y-monaco, y-websocket) — Binary CRDT synchronization engine, GitHub, 2024–2026.', 13.5, 1),
        plainP('Microsoft Corporation — Monaco Editor & Language Server Protocol (LSP) Specification, 2024–2026.', 13.5, 1),
        plainP('Judge0 CE — Open-source Docker-sandboxed multi-language code execution system; Socket.IO & Coturn TURN/STUN.', 13.5, 1),
        plainP('Envoy Proxy (Ring-Hash Load Balancing), Nginx, PM2 Process Manager, Kubernetes/EKS, k6 Load Testing, Prometheus & Grafana.', 13.5, 1),
      ]),
    },
  ];

  // Add diagrams to ppt/media/ and create slides + slide rels
  let nextMediaNum = 2; // image1.png is Bahria logo from slideLayout1
  const slideRelsEntries = [];
  const slideIdListEntries = [];
  const contentTypeSlideOverrides = [];

  for (let i = 0; i < slideDefs.length; i++) {
    const slideNum = i + 1;
    const def = slideDefs[i];
    const slidePath = `ppt/slides/slide${slideNum}.xml`;
    const slideRelsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;

    let relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="${def.layout}"/>`;

    let slideXml = def.rawXml || def.xml;

    if (def.diagram) {
      const pngPath = path.join(DIAGRAMS_DIR, def.diagram);
      if (!fs.existsSync(pngPath)) {
        throw new Error(`Missing diagram PNG: ${pngPath}. Run generate_uml_diagrams.js first.`);
      }
      const mediaFileName = `image${nextMediaNum++}.png`;
      zip.file(`ppt/media/${mediaFileName}`, fs.readFileSync(pngPath));
      relsXml += `\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaFileName}"/>`;
      slideXml = buildDiagramSlideXml(def.title, def.caption, 'rId2');
    }

    relsXml += '\n</Relationships>';

    zip.file(slidePath, slideXml);
    zip.file(slideRelsPath, relsXml);

    const presRId = `rIdSlide${slideNum}`;
    slideRelsEntries.push(
      `  <Relationship Id="${presRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNum}.xml"/>`
    );
    slideIdListEntries.push(`<p:sldId id="${255 + slideNum}" r:id="${presRId}"/>`);
    contentTypeSlideOverrides.push(
      `  <Override PartName="/ppt/slides/slide${slideNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    );
  }

  // Update ppt/presentation.xml (<p:sldIdLst>)
  let presXml = await zip.file('ppt/presentation.xml').async('string');
  presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${slideIdListEntries.join('')}</p:sldIdLst>`);
  zip.file('ppt/presentation.xml', presXml);

  // Update ppt/_rels/presentation.xml.rels (keep non-slide rels, replace slide rels)
  let presRelsXml = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  presRelsXml = presRelsXml.replace(/<Relationship[^>]*Type="[^"]*\/relationships\/slide"[^>]*\/>\s*/g, '');
  presRelsXml = presRelsXml.replace('</Relationships>', `${slideRelsEntries.join('\n')}\n</Relationships>`);
  zip.file('ppt/_rels/presentation.xml.rels', presRelsXml);

  // Update [Content_Types].xml (replace slide overrides cleanly, ensure png default exists)
  let ctXml = await zip.file('[Content_Types].xml').async('string');
  ctXml = ctXml.replace(/<Override[^>]*PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>\s*/g, '');
  if (!/Extension="png"/i.test(ctXml)) {
    ctXml = ctXml.replace('<Types ', '<Types ').replace('>', '><Default Extension="png" ContentType="image/png"/>');
  }
  ctXml = ctXml.replace('</Types>', `${contentTypeSlideOverrides.join('\n')}\n</Types>`);
  zip.file('[Content_Types].xml', ctXml);

  // Update docProps/app.xml slide count
  const appXmlFile = zip.file('docProps/app.xml');
  if (appXmlFile) {
    let appXml = await appXmlFile.async('string');
    appXml = appXml.replace(/<Slides>\d+<\/Slides>/, `<Slides>${slideDefs.length}</Slides>`);
    zip.file('docProps/app.xml', appXml);
  }

  const outBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(OUTPUT_PPTX, outBuf);

  console.log('=== Final CollabIDE PowerPoint Presentation Generated ===');
  console.log(`Template Base: ${blueprint.sourceFile} (${blueprint.slideSize.cx.inches}" x ${blueprint.slideSize.cy.inches}")`);
  console.log(`Total Slides:  ${slideDefs.length} (including 7 embedded 2x-DPI UML & Scrumban diagrams)`);
  console.log(`Output PPTX:   ${path.relative(REPO_ROOT, OUTPUT_PPTX).replace(/\\/g, '/')} (${(outBuf.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('PPTX build failed:', err);
  process.exit(1);
});
