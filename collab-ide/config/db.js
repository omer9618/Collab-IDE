const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const connUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/collabide';
    
    // Mongoose connection options matching NFR-40
    const options = {
      maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '20', 10),
      minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10),
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    };

    const conn = await mongoose.connect(connUri, options);
    console.log(`🔌 MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
