// api/index.js
const express = require("express");
const fileUpload = require("express-fileupload");
const { Client, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const XLSX = require("xlsx");
const http = require("http");
const { Server } = require("socket.io");

const PORT = 3000;

// Create express app + server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // Allow Vercel or any frontend
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload());
app.use(express.static("public"));

// WhatsApp client initialization
const client = new Client();

client.on("qr", async (qr) => {
  console.log("📲 Scan QR code in browser to log in...");
  const qrImageUrl = await qrcode.toDataURL(qr);
  io.emit("qr", qrImageUrl); // Always emit fresh QR on refresh or reconnection
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
  io.emit("ready", true);
});

// Reset QR if disconnected
client.on("disconnected", () => {
  console.log("❌ WhatsApp disconnected. Reinitializing...");
  client.initialize();
});

// API endpoint
app.post("/send", async (req, res) => {
  try {
    let numbers = [];

    // Manual input numbers
    if (req.body.numbers?.trim()) {
      numbers = req.body.numbers.split(",").map((n) => n.trim());
    }

    // Excel upload numbers
    if (req.files?.excel) {
      const workbook = XLSX.read(req.files.excel.data, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      const excelNumbers = data
        .map((row) => String(row[Object.keys(row)[0]] || "").trim())
        .filter((val) => /^\d+$/.test(val)); // keep only numeric
      numbers = numbers.concat(excelNumbers);
    }

    // Clean, normalize, deduplicate
    numbers = [...new Set(
      numbers
        .map((n) => n.replace(/\D/g, ""))
        .filter((n) => n.length >= 10)
        .map((n) => (n.startsWith("91") ? `+${n}` : `+91${n.slice(-10)}`))
    )];

    if (!numbers.length) {
      return res.status(400).json({ error: "No valid numbers found." });
    }

    // Prepare message
    let message = req.body.message || "";
    message += `

🟩 *[📞 CALL US](tel:+919723625050)*  
🟩 *[🌐 VISIT NOW](https://www.promiseacademy.co.in/)*`;

    const mediaFile = req.files?.media || null;

    if (!message.trim() && !mediaFile) {
      return res.status(400).json({ error: "Message or media is required." });
    }

    const delay = Math.max(parseInt(req.body.delay) || 2000, 1500);
    let sentCount = 0,
      skippedCount = 0,
      failedCount = 0;

    (async () => {
      const total = numbers.length;
      for (let i = 0; i < total; i++) {
        const chatId = numbers[i].replace("+", "") + "@c.us";
        try {
          const isRegistered = await client.isRegisteredUser(chatId);
          if (!isRegistered) {
            skippedCount++;
            io.emit("status", `⚠️ Skipped ${numbers[i]}`);
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
          io.emit("status", `✅ (${i + 1}/${total}) Sent to ${numbers[i]}`);
        } catch (err) {
          failedCount++;
          io.emit(
            "status",
            `❌ (${i + 1}/${total}) Failed to send to ${numbers[i]}: ${err.message}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      io.emit(
        "status",
        `🎉 Done! ✅ Sent: ${sentCount}, ⚠️ Skipped: ${skippedCount}, ❌ Failed: ${failedCount}`
      );
    })();

    res.json({ status: "sending", total: numbers.length });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

client.initialize();

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
