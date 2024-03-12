const express = require("express");
const { exec } = require("child_process");
const si = require("systeminformation");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const config = require("dotenv").config({ path: "./Config/Config.env" });
const path = require("path");
const Razorpay = require("razorpay");
const dbConnection = require("./connection.js");
const archiver = require("archiver");


const app = express();
const port = 5000;
const RAZORPAY_API_KEY = "rzp_test_cAH0tlxoBYQzoL";
const RAZORPAY_SECRET_KEY = "MHU6WLikqViBs1QSpVm0S9Pa";
// Use the cors middleware
app.use(cors("*"));
// Middleware to parse incoming JSON
// app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());



// System Information receive

app.get("/system-info", async (req, res) => {
  try {
    const systemInfo = await si.system();
    const osInfo = await si.osInfo();
    const cpuInfo = await si.cpu();
    const memInfo = await si.mem();

    // Use wmic to get the device name
    exec("wmic computersystem get caption", (error, stdout) => {
      if (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
        return;
      }

      const deviceName = stdout.split("\n")[1].trim();

      const additionalInfo = {
        deviceName,
        deviceID: systemInfo.serial,
        installedRAM: memInfo.total / (1024 * 1024 * 1024), // Convert to GB
        productID: systemInfo.product,
        systemType: systemInfo.manufacturer,
      };

      const finalInfo = {
        ...additionalInfo,
        model: systemInfo.model,
        os: `${osInfo.distro} ${osInfo.release}`,
        processor: `${cpuInfo.manufacturer} ${cpuInfo.brand}`,
      };
      res.json(finalInfo);
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const runWMICCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        const lines = stdout.trim().split("\n");
        const values = lines.slice(1).map((line) => line.trim().split(/\s+/));
        resolve(values);
      }
    });
  });
};

const bytesToGB = (bytes) => {
  return bytes / (1024 * 1024 * 1024);
};

app.get("/systeminfo", async (req, res) => {
  try {
    const cpuInfo = await runWMICCommand("wmic cpu get name");
    const osInfo = await runWMICCommand("wmic os get Caption");
    const diskInfoBytes = await runWMICCommand("wmic diskdrive get size");
    const memoryInfoBytes = await runWMICCommand(
      "wmic MEMORYCHIP get Capacity"
    );
    const videoControllerInfo = await runWMICCommand(
      "wmic path Win32_VideoController get name"
    );
    const diskInfoGB = diskInfoBytes.map((bytes) =>
      bytesToGB(parseFloat(bytes))
    );
    const memoryInfoGB = memoryInfoBytes.map((bytes) =>
      bytesToGB(parseFloat(bytes))
    );
    const systemInfo = {
      cpuInfo,
      osInfo,
      diskInfo: diskInfoGB,
      memoryInfo: memoryInfoGB,
      videoControllerInfo,
    };
    res.json(systemInfo);
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



// Connect to MongoDB (make sure your MongoDB server is running)

// mongoose.connect("mongodb+srv://vinayuncodemy:djEXjT6S6f3UsFWX@cluster0.nckix13.mongodb.net/UserData");
// const db = mongoose.connection;
// db.on("error", console.error.bind(console, "MongoDB connection error:"));
// db.once("open", () => {
//   console.log("Connected to MongoDB");
// });

dbConnection();

// Define a mongoose schema for your data
const formDataSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  emailAddress: String,
  phoneNumber: Number,
  licenseKey: String,
});

const FormData = mongoose.model("UserFormData", formDataSchema);

// Razarpay Integration Start

// const instance = new Razorpay({
//   key_id: process.env.RAZORPAY_API_KEY ,
//   key_secret: process.env.RAZORPAY_SECRET_KEY,
// });
const instance = new Razorpay({
  key_id: RAZORPAY_API_KEY,
  key_secret: RAZORPAY_SECRET_KEY,
});
// console.log("key :",instance)

// Middleware to create Razorpay order
const createRazorpayOrder = async (req, res, next) => {
  try {
    const options = {
      amount: 50000, // amount in the smallest currency unit
      currency: "INR",
    };
    const order = await instance.orders.create(options);
    // console.log('middleware order =',order)
    req.razorpayOrder = order;
    next();
  } catch (error) {
    console.error("Razorpay order creation failed:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

app.post("/checkout", createRazorpayOrder, async (req, res) => {
  // console.log("check out req body =",req,req.body)
  var options = {
    amount: 50000, // amount in the smallest currency unit
    currency: "INR",
  };
  const order = await instance.orders.create(options);
  // console.log('route order =',order)

  // console.log("order", order);
  res.status(200).json({
    success: true,
    order: req.razorpayOrder,
  });
});

// Function to calculate HMAC SHA256
function hmac_sha256(data, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(data);
  return hmac.digest("hex");
}

app.post("/paymentverification", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    console.log(
      "order_id :",
      razorpay_order_id,
      "payment_id :",
      razorpay_payment_id,
      "signature :",
      razorpay_signature
    );

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", RAZORPAY_SECRET_KEY)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      console.log("Payment is successful");

      res.redirect(
        `https://driverupdater.netlify.app/paymentsuccseful?reference=${razorpay_payment_id}`
      );
    } else {
      console.log("Payment verification failed");
      // Handle verification failure
      res.status(400).json({ error: "Payment verification failed" });
    }
  } catch (error) {
    console.error("Error during payment verification:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//  Razarpay Integration End

app.post("/submit-form", async (req, res) => {
  const { firstName, lastName, emailAddress, phoneNumber } = req.body;

  try {
    console.log("Received form data:", req.body);
    // Generate a random license key
    const licenseKey = crypto.randomBytes(10).toString("hex");

    const formData = new FormData({
      firstName,
      lastName,
      emailAddress,
      phoneNumber,
      licenseKey,
    });

    // Save form data to the database
    await formData.save();

    // Encrypt the license key with JWT
    const token = jwt.sign({ licenseKey }, "your-secret-key");

    // Send email using nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "vinay.uncodemy@gmail.com",
        pass: "yilc lfcb ktcc rxeg",
      },
    });

    const mailOptions = {
      from: "vinay.uncodemy@gmail.com",
      to: emailAddress,
      subject: " Your DevCleaner License Key",
      text: `Dear , ${firstName},\nWe hope this message finds you well. Thank you for choosing DevCleaner.
We are pleased to provide you with your license key for accessing our software/service.\n
Your License key is: ${licenseKey}\n
Please keep this key confidential and do not share it with unauthorized individuals.
Here are some important details and instructions:
Product: DevCleaner \n 
License Type: [confidential]
Activation Instructions:
[Step 1] : Open our app 
[Step 2] : Click Register Now
[Step 3] : Enter Your Email and License key

Important Notes:

This license key is valid for [1 Year], if applicable.
For any technical assistance or inquiries, please contact our support team at [vinay.uncodemy@gmail.com/9898989898].
We appreciate your business and hope you enjoy using DevCleaner. 
If you encounter any issues during activation or have questions, feel free to reach out to us.

Best regards,

Vinay Nayak
Software Developer
GVCloud Secure Pvt.ltd.
 `,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Email sending failed:", error);
        res.status(500).send("Internal Server Error");
      } else {
        console.log("Email sent:", info.response);
        res.status(200).send("Form data saved successfully and email sent!");
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// app.get('/getlicenseKey',async(req,res)=>{
//    const {email,licenseKey}=req.body

//    const error = validationResult(req)

//    if(!error.isEmpty()){
//     res.status(400).json({"error":error.array()})
//    } else{
//     console.log("user Email :",email,"user LicenseKey :",licenseKey)

//     try{
//       let userEmail = await FormData.findOne({emailAddress})

//       if(!userEmail){
//         console.log("user is not found Please Check your email :",userEmail)
//         return res.status(400).json({"error ":"user is not found Please Check your email"})
//       }else{
//         let userLicenseKey = await FormData.findOne({licenseKey})

//         if(!userLicenseKey){
//           console.log("Your LicenseKey is not Correct :",userLicenseKey)
//         }else{

//         }
//       }
//     }catch{
//       console.log("Error",error)
//     }
//    }

// })

app.post("/getlicenseKey", async (req, res) => {
  const { email, licenseKey } = req.body;

  try {
    const user = await FormData.findOne({
      emailAddress: email,
      licenseKey: licenseKey,
    });

    if (!user) {
      console.log("User not found or license key is incorrect");
      return res
        .status(400)
        .json({ error: "User not found or license key is incorrect" });
    }

    console.log("User found and license key is correct");
    res
      .status(200)
      .json({ status: true, success: "User found and license key is correct" });
  } catch (error) {
    console.error("Error", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// app.get('/download', async (req, res) => {
//   // Constructing an absolute path using path.join
//   const filePath = path.join(__dirname, 'msi', 'DevCleaner.zip');

//   // Set headers for the response
//   res.setHeader('Content-Disposition', 'attachment; filename=DevCleaner.zip');
//   res.setHeader('Content-Type', 'application/zip');

//   // Send the file
//   res.download(filePath, (err) => {
//     if (err) {
//       // Handle errors, e.g., file not found
//       console.error(err);
//       res.status(404).send('File not found');
//     }
//   });
// });

app.get("/download", (req, res) => {
  const folderPath = path.join(__dirname, "msi", "DevClenerfile"); // Assuming 'DevClenerfile' is the folder name
  console.log("Path from where the file is to be downloaded:", folderPath);

  // Create a zip archive
  const archive = archiver("zip", { zlib: { level: 9 } });

  // Set headers for the response
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=DevClenerfile.zip`
  );
  res.setHeader("Content-Type", "application/zip");

  // Pipe the archive to the response
  archive.pipe(res);

  // Add the entire folder to the archive
  archive.directory(folderPath, false);

  // Finalize the archive and send the response
  archive.finalize();

  archive.on("error", (err) => {
    console.error(err);
    res.status(500).send("Internal Server Error");
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
