const express = require("express");
const fileUpload = require("express-fileupload");
const { Client, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const XLSX = require("xlsx");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload());
app.use(express.static("public")); // Serve HTML form

// WhatsApp client
const client = new Client();

client.on("qr", (qr) => {
  console.log("Scan this QR to log in:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

// API to send messages
app.post("/send", async (req, res) => {
  try {
    let numbers = [];

    // If numbers entered manually
    if (req.body.numbers && req.body.numbers.trim() !== "") {
      numbers = req.body.numbers.split(",").map((n) => n.trim());
    }

    // If Excel file uploaded
    if (req.files && req.files.excel) {
      const workbook = XLSX.read(req.files.excel.data, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      const excelNumbers = data.map((row) => String(row.PhoneNumber).trim());
      numbers = numbers.concat(excelNumbers);
    }

    // Prepare message
    let message = req.body.message || "";

    // Append call & contact links
    message += `\n\n📞 Call Us: +91 9723625050\n🌐 Contact Us: https://www.promiseacademy.co.in/`;

    const delay = parseInt(req.body.delay) || 2000;

    let mediaFile = null;
    if (req.files && req.files.media) {
      mediaFile = req.files.media;
    }

    // Start sending asynchronously
    (async () => {
      for (let i = 0; i < numbers.length; i++) {
        const chatId = numbers[i] + "@c.us";
        try {
          if (mediaFile) {
            const media = new MessageMedia(
              mediaFile.mimetype,
              mediaFile.data.toString("base64"),
              mediaFile.name
            );
            await client.sendMessage(chatId, media, { caption: message });
          } else {
            await client.sendMessage(chatId, message);
          }

          io.emit("status", `✅ Sent to ${numbers[i]}`);
        } catch (err) {
          io.emit(
            "status",
            `❌ Failed to send to ${numbers[i]}: ${err.message}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      io.emit("status", "🎉 All messages processed!");
    })();

    res.send("Sending started... check status below 👇");
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Error sending messages");
  }
});

client.initialize();

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
