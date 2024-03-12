const mongoose = require("mongoose");

// Connect to MongoDB (make sure your MongoDB server is running)

async function dbConnection() {
  mongoose.connect('mongodb+srv://studentDashboard:RMS40ArMPPYcOBEM@cluster0.qygnrxp.mongodb.net/UserData') 
    // mongoose.connect('mongodb://127.0.0.1:27017/UserData')
        .then(() => console.log("MongoDB Connected"))
        .catch((err) => console.log("Mongo Error", err));
}

module.exports=dbConnection
