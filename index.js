const express = require("express");
const fileUpload = require("express-fileupload");
const { Client, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const XLSX = require("xlsx");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
// const PORT = 3000;
const PORT = process.env.PORT || 3000;


app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload());
app.use(express.static("public")); // Serve HTML form

// WhatsApp client
const client = new Client();
let qrGenerated = false; // prevent QR refresh

// Send QR to browser only once
client.on("qr", async (qr) => {
  if (!qrGenerated) {
    console.log("📲 Scan QR code in browser to log in...");
    const qrImageUrl = await qrcode.toDataURL(qr);
    io.emit("qr", qrImageUrl);
    qrGenerated = true;
  }
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
  io.emit("ready", true);
});

// API to send messages
app.post("/send", async (req, res) => {
  try {
    let numbers = [];

    // Manual numbers
    if (req.body.numbers && req.body.numbers.trim() !== "") {
      numbers = req.body.numbers.split(",").map((n) => n.trim());
    }

    // Numbers from Excel
    if (req.files && req.files.excel) {
      const workbook = XLSX.read(req.files.excel.data, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      const excelNumbers = data.map((row) => {
        const firstKey = Object.keys(row)[0];
        return String(row[firstKey]).trim();
      });
      numbers = numbers.concat(excelNumbers);
    }

    // Clean numbers: only digits, add +91 if missing
    numbers = numbers
      .map((n) => n.replace(/\D/g, "")) // keep digits only
      .filter((n) => n.length >= 10)
      .map((n) => (n.startsWith("91") ? `+${n}` : `+91${n.slice(-10)}`));

    if (numbers.length === 0) {
      return res.status(400).send("No valid numbers found.");
    }

    // Prepare message with button-like links
    let message = req.body.message || "";
    message += `

🟩 *[📞 CALL US](tel:+919723625050)*  
🟩 *[🌐 VISIT NOW](https://www.promiseacademy.co.in/)*
`;

    const delay = Math.max(parseInt(req.body.delay) || 2000, 1500);

    let mediaFile = null;
    if (req.files && req.files.media) {
      mediaFile = req.files.media;
    }

    // Counters
    let sentCount = 0,
      skippedCount = 0,
      failedCount = 0;

    // Start sending asynchronously
    (async () => {
      const total = numbers.length;
      for (let i = 0; i < total; i++) {
        const chatId = numbers[i].replace("+", "") + "@c.us";

        try {
          const isRegistered = await client.isRegisteredUser(chatId);
          if (!isRegistered) {
            skippedCount++;
            io.emit(
              "status",
              `⚠️ Skipped ${numbers[i]} (not on WhatsApp) | Sent: ${sentCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`
            );
            continue;
          }

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

          sentCount++;
          io.emit(
            "status",
            `✅ (${i + 1}/${total}) Sent to ${numbers[i]} | Sent: ${sentCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`
          );
        } catch (err) {
          failedCount++;
          io.emit(
            "status",
            `❌ (${i + 1}/${total}) Failed to send to ${numbers[i]}: ${err.message} | Sent: ${sentCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      io.emit(
        "status",
        `🎉 All messages processed!\n📊 Final Summary → ✅ Sent: ${sentCount}, ⚠️ Skipped: ${skippedCount}, ❌ Failed: ${failedCount}`
      );
    })();

    res.send("✅ Sending started... check status below 👇");
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Error sending messages");
  }
});

client.initialize();

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
