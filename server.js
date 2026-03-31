const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

/* 🔹 ADDED for Excel Upload */
const multer = require("multer");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 5000;

/* ---------------- Middleware ---------------- */
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* ---------------- MySQL Connection ---------------- */
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "root",
  database: "vendor_db",
  port: 3306,
});

/* ---------------- Test DB Connection ---------------- */
db.getConnection((err, connection) => {
  if (err) {
    console.log("❌ MySQL Connection Failed:", err.message);
  } else {
    console.log("✅ MySQL Connected Successfully");
    connection.release();
  }
});

/* ============================================================
   API 1: Save Vendor Sheet + Customer Items (MANUAL ENTRY)
   ============================================================ */

app.post("/saveSheet", (req, res) => {
  console.log("📌 Received Data:", req.body);

  const { vendor_name, sheet_date, items } = req.body;

  if (!vendor_name || !sheet_date || !items || items.length === 0) {
    return res.status(400).json({
      message: "❌ Missing vendor_name, sheet_date or items",
    });
  }

  /* ---------- Insert Vendor Header ---------- */
  const sheetQuery = `
    INSERT INTO vendor_sheet (vendor_name, sheet_date)
    VALUES (?, ?)
  `;

  db.query(sheetQuery, [vendor_name, sheet_date], (err, sheetResult) => {
    if (err) {
      console.error("❌ Error inserting vendor sheet:", err.message);
      return res.status(500).json({
        message: "Error saving vendor sheet header",
      });
    }

    const sheet_id = sheetResult.insertId;

    /* ---------- Insert Customer Items ---------- */
    const itemQuery = `
      INSERT INTO customer_items
      (sheet_id, customer_name, part_no, description, make, qty, price_per_unit, total_value, hsn_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    let insertedCount = 0;

    items.forEach((row) => {
      db.query(
        itemQuery,
        [
          sheet_id,
          row.customer_name || null,
          row.part_no || null,
          row.description || null,
          row.make || null,
          row.qty || 0,
          row.price_per_unit || 0,
          row.total_value || 0,
          row.hsn_code || null,
        ],
        (err) => {
          if (err) {
            console.error("❌ Error inserting customer item:", err.message);
            return res.status(500).json({
              message: "❌ Error saving customer row data",
            });
          }

          insertedCount++;

          if (insertedCount === items.length) {
            return res.status(200).json({
              message: "✅ Vendor Sheet + Customer Items Saved Successfully!",
              sheet_id,
            });
          }
        }
      );
    });
  });
});

/* ============================================================
   API 2: Fetch All Vendor Sheets
   ============================================================ */

app.get("/allSheets", (req, res) => {
  const query = `
    SELECT * FROM vendor_sheet
    ORDER BY sheet_id DESC
  `;

  db.query(query, (err, result) => {
    if (err) {
      console.error("❌ Error Fetching Sheets:", err.message);
      return res.status(500).json({ message: "Error fetching sheets" });
    }

    res.json(result);
  });
});

/* ============================================================
   API 3: Fetch Full Sheet with Customer Items
   ============================================================ */

app.get("/sheet/:id", (req, res) => {
  const sheetId = req.params.id;

  const sheetQuery = `
    SELECT * FROM vendor_sheet
    WHERE sheet_id = ?
  `;

  db.query(sheetQuery, [sheetId], (err, sheetResult) => {
    if (err) {
      console.error("❌ Error Fetching Vendor Sheet:", err.message);
      return res.status(500).json({ message: "Error fetching sheet" });
    }

    const itemsQuery = `
      SELECT * FROM customer_items
      WHERE sheet_id = ?
      ORDER BY item_id ASC
    `;

    db.query(itemsQuery, [sheetId], (err, itemsResult) => {
      if (err) {
        console.error("❌ Error Fetching Items:", err.message);
        return res.status(500).json({ message: "Error fetching items" });
      }

      res.json({
        sheet: sheetResult[0],
        items: itemsResult,
      });
    });
  });
});

/* ============================================================
   API 4: Upload Excel File and Save to DB
   ============================================================ */

/* ---------- Multer Config ---------- */
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

/* ---------- Excel Upload API ---------- */
app.post("/uploadExcel", upload.single("file"), (req, res) => {
  try {
    const { vendor_name, sheet_date } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "❌ No Excel file uploaded" });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (!rows.length) {
      return res.status(400).json({ message: "❌ Excel file is empty" });
    }

    /* ---------- Insert Vendor Sheet ---------- */
    const sheetQuery = `
      INSERT INTO vendor_sheet (vendor_name, sheet_date)
      VALUES (?, ?)
    `;

    db.query(sheetQuery, [vendor_name, sheet_date], (err, sheetResult) => {
      if (err) {
        console.error("❌ Sheet insert error:", err.message);
        return res.status(500).json({ message: "Error saving sheet" });
      }

      const sheet_id = sheetResult.insertId;

      const itemQuery = `
        INSERT INTO customer_items
        (sheet_id, customer_name, part_no, description, make, qty, price_per_unit, total_value, hsn_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      let inserted = 0;

      rows.forEach((row) => {
        db.query(
          itemQuery,
          [
            sheet_id,
            row.customer_name || null,
            row.part_no || null,
            row.description || null,
            row.make || null,
            row.qty || 0,
            row.price_per_unit || 0,
            row.total_value || 0,
            row.hsn_code || null,
          ],
          (err) => {
            if (err) {
              console.error("❌ Row insert error:", err.message);
              return res.status(500).json({
                message: "❌ Error inserting Excel rows",
              });
            }

            inserted++;

            if (inserted === rows.length) {
              return res.status(200).json({
                message: "✅ Excel Uploaded & Saved Successfully",
                sheet_id,
              });
            }
          }
        );
      });
    });
  } catch (error) {
    console.error("❌ Excel Upload Error:", error);
    res.status(500).json({ message: "Excel upload failed" });
  }
});

/* ============================================================
   Start Server
   ============================================================ */

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
