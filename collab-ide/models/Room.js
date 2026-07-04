const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: ['Owner', 'Room Leader', 'Editor', 'Viewer'],
    default: 'Viewer',
  },
});

const fileSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    default: '',
  },
});

/**
 * Stores the outcome of a single code execution run (FR-29).
 * Persisted so late-joining participants can hydrate the output panel (FR-35).
 */
const executionResultSchema = new mongoose.Schema({
  triggeredBy: { type: String, required: true },    // displayName of executor
  language:    { type: String, required: true },    // human-readable language name
  languageId:  { type: Number, required: true },    // Judge0 language ID
  stdout:      { type: String, default: '' },
  stderr:      { type: String, default: '' },
  status:      { type: String, default: 'Unknown' }, // Judge0 status description
  time:        { type: String, default: null },      // seconds as string e.g. "0.025"
  memory:      { type: Number, default: null },      // KB
  ranAt:       { type: Date,   default: Date.now },
});

const roomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    uuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    participants: [participantSchema],
    isClosed: {
      type: Boolean,
      default: false,
    },
    files: [fileSchema],
    // Last 20 execution results for this room (NFR-37 compliant — capped in route handler)
    executionHistory: [executionResultSchema],
  },
  {
    timestamps: true,
  }
);

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;
