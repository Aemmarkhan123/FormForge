
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const path = require("node:path");
const { OAuth2Client } = require("google-auth-library");
const db = require("./database");

const app = express();
const PORT = Number(process.env.PORT) || 5001;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

for (const key of [
  "ADMIN_EMAIL",
  "SMTP_USER",
  "SMTP_PASS",
  "JWT_SECRET",
  "GOOGLE_CLIENT_ID",
]) {
  if (!process.env[key]?.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters long.");
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.use(cors({
  origin: FRONTEND_URL,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "30kb" }));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function sendMail(options) {
  return transporter.sendMail({
    from: `"AYM Forms" <${process.env.SMTP_USER}>`,
    ...options,
  });
}

function signToken(email) {
  return jwt.sign({ email }, JWT_SECRET, { expiresIn: "2h" });
}

function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Please log in first." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      message: "Session expired or invalid. Please log in again.",
    });
  }
}

function validEmail(value) {
  return typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) &&
    value.length <= 254;
}

function normalizeFields(fields) {
  const allowedTypes = [
    "text", "textarea", "email", "number", "select", "radio",
  ];

  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 50) {
    throw new Error("Add between 1 and 50 questions.");
  }

  const ids = new Set();

  return fields.map((field) => {
    if (!field || typeof field !== "object") {
      throw new Error("Invalid question.");
    }

    const id = String(field.id || "");
    const label = String(field.label || "").trim();
    const type = String(field.type || "text");

    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id) || ids.has(id)) {
      throw new Error("Every question needs a unique ID.");
    }

    ids.add(id);

    if (!label || label.length > 200) {
      throw new Error("Question labels must be 1–200 characters.");
    }

    if (!allowedTypes.includes(type)) {
      throw new Error("Unsupported question type.");
    }

    let options = [];

    if (type === "select" || type === "radio") {
      if (!Array.isArray(field.options) ||
          field.options.length < 2 ||
          field.options.length > 30) {
        throw new Error("Choice questions need 2–30 options.");
      }

      options = field.options.map((option) => {
        if (typeof option !== "string" ||
            !option.trim() || option.length > 150) {
          throw new Error("Invalid choice option.");
        }
        return option.trim();
      });

      if (new Set(options).size !== options.length) {
        throw new Error("Choice options must be unique.");
      }
    }

    return {
      id,
      label,
      type,
      required: field.required === true,
      options,
    };
  });
}

function validateAnswers(fields, answers) {
  if (!answers || typeof answers !== "object" ||
      Array.isArray(answers)) {
    throw new Error("Please provide your answers.");
  }

  const allowedIds = new Set(fields.map((field) => field.id));

  if (Object.keys(answers).some((key) => !allowedIds.has(key))) {
    throw new Error("Unexpected answer field.");
  }

  const cleaned = {};

  for (const field of fields) {
    const value = answers[field.id];

    if (value === undefined || value === null || value === "") {
      if (field.required) {
        throw new Error(`"${field.label}" is required.`);
      }
      cleaned[field.id] = "";
      continue;
    }

    if (typeof value !== "string" || value.length > 5000) {
      throw new Error(`Invalid answer for "${field.label}".`);
    }

    const answer = value.trim();

    if (field.required && !answer) {
      throw new Error(`"${field.label}" is required.`);
    }

    if (field.type === "email" && answer && !validEmail(answer)) {
      throw new Error(`Enter a valid email for "${field.label}".`);
    }

    if (field.type === "number" && answer &&
        !Number.isFinite(Number(answer))) {
      throw new Error(`Enter a number for "${field.label}".`);
    }

    if (
      ["select", "radio"].includes(field.type) &&
      answer && !field.options.includes(answer)
    ) {
      throw new Error(`Invalid choice for "${field.label}".`);
    }

    cleaned[field.id] = answer;
  }

  return cleaned;
}

function formRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    slug: row.slug,
    fields: JSON.parse(row.fields_json),
    published: Boolean(row.published),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownedForm(id, email) {
  return db.prepare(
    "SELECT * FROM forms WHERE id = ? AND owner_email = ?"
  ).get(id, email);
}

app.get("/", (req, res) => {
  res.json({ message: "AYM Forms API is running." });
});

// SIGNUP
app.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!validEmail(email) ||
        typeof password !== "string" ||
        password.length < 8 || password.length > 128) {
      return res.status(400).json({
        message: "Enter a valid email and a password of 8–128 characters.",
      });
    }

    const normalized = email.trim().toLowerCase();

    if (db.prepare("SELECT email FROM users WHERE email = ?").get(normalized)) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    db.prepare(`
      INSERT INTO users (email, password_hash, verified)
      VALUES (?, ?, 0)
    `).run(normalized, passwordHash);

    db.prepare(`
      INSERT INTO verification_tokens (token_hash, email, expires_at)
      VALUES (?, ?, ?)
    `).run(tokenHash, normalized, Date.now() + 15 * 60 * 1000);

    const link = new URL("/verify-email", BASE_URL);
    link.searchParams.set("token", rawToken);

    try {
      await sendMail({
        to: normalized,
        subject: "Verify your email — AYM Forms",
        html: `
          <h2>Welcome to AYM Forms</h2>
          <p>Click below to verify your account.</p>
          <p><a href="${link.toString()}">Verify email</a></p>
          <p>This link expires in 15 minutes.</p>
        `,
      });
    } catch (error) {
      db.prepare("DELETE FROM users WHERE email = ?").run(normalized);
      throw error;
    }

    res.status(201).json({
      message: "Signup successful. Check your email to verify your account.",
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    res.status(500).json({ message: "Signup or verification email failed." });
  }
});

// VERIFY EMAIL
app.get("/verify-email", (req, res) => {
  const rawToken = req.query.token;

  if (typeof rawToken !== "string") {
    return res.status(400).send("Invalid verification link.");
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const record = db.prepare(`
    SELECT email, expires_at FROM verification_tokens WHERE token_hash = ?
  `).get(tokenHash);

  if (!record || record.expires_at < Date.now()) {
    if (record) {
      db.prepare("DELETE FROM verification_tokens WHERE token_hash = ?")
        .run(tokenHash);
    }
    return res.status(400).send("Verification link invalid or expired.");
  }

  const activate = db.transaction(() => {
    db.prepare("UPDATE users SET verified = 1 WHERE email = ?")
      .run(record.email);
    db.prepare("DELETE FROM verification_tokens WHERE token_hash = ?")
      .run(tokenHash);
  });

  activate();

  res.send(`
    <!doctype html>
    <html><head><meta name="viewport" content="width=device-width">
    <title>Email verified</title></head>
    <body style="font-family:Arial;background:#101010;color:#fff;text-align:center;padding:60px 20px">
      <h2>Email verified successfully!</h2>
      <p>You can now log in to AYM Forms.</p>
      <a style="color:white" href="${FRONTEND_URL}">Open app</a>
    </body></html>
  `);
});

// EMAIL LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!validEmail(email) || typeof password !== "string") {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const normalized = email.trim().toLowerCase();
    const user = db.prepare(`
      SELECT email, password_hash, verified FROM users WHERE email = ?
    `).get(normalized);

    if (!user || !user.password_hash ||
        !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!user.verified) {
      return res.status(403).json({
        message: "Verify your email before logging in.",
      });
    }

    res.json({
      message: "Login successful!",
      token: signToken(user.email),
      email: user.email,
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Login failed." });
  }
});

// GOOGLE LOGIN / SIGNUP
app.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body || {};

    if (typeof credential !== "string") {
      return res.status(400).json({ message: "Google credential required." });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email ||
        payload.email_verified !== true) {
      return res.status(401).json({
        message: "Google account could not be verified.",
      });
    }

    const email = payload.email.trim().toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user) {
      db.prepare(`
        INSERT INTO users (email, password_hash, verified, google_sub)
        VALUES (?, NULL, 1, ?)
      `).run(email, payload.sub);
    } else if (user.google_sub !== payload.sub) {
      return res.status(409).json({
        message: "An account already uses this email. Use its existing login method.",
      });
    }

    res.json({
      message: "Google sign-in successful!",
      token: signToken(email),
      email,
    });
  } catch (error) {
    console.error("Google authentication error:", error.message);
    res.status(401).json({ message: "Google sign-in failed." });
  }
});

// CREATE FORM
app.post("/forms", authenticateToken, (req, res) => {
  try {
    const { title, description = "", fields } = req.body || {};

    if (typeof title !== "string" || !title.trim() ||
        title.length > 150 || typeof description !== "string" ||
        description.length > 2000) {
      return res.status(400).json({ message: "Invalid title or description." });
    }

    const normalizedFields = normalizeFields(fields);
    const id = crypto.randomUUID();
    const slug = crypto.randomBytes(9).toString("base64url");

    db.prepare(`
      INSERT INTO forms (id, owner_email, title, description, slug, fields_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id, req.user.email, title.trim(), description.trim(),
      slug, JSON.stringify(normalizedFields)
    );

    res.status(201).json({
      message: "Form created.",
      form: formRow(db.prepare("SELECT * FROM forms WHERE id = ?").get(id)),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || "Could not create form." });
  }
});

// LIST FORMS
app.get("/forms", authenticateToken, (req, res) => {
  const rows = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM form_responses r WHERE r.form_id = f.id) AS response_count
    FROM forms f
    WHERE f.owner_email = ?
    ORDER BY f.created_at DESC
  `).all(req.user.email);

  res.json({
    forms: rows.map((row) => ({
      ...formRow(row),
      responseCount: row.response_count,
    })),
  });
});

// GET FORM
app.get("/forms/:id", authenticateToken, (req, res) => {
  const form = ownedForm(req.params.id, req.user.email);
  if (!form) return res.status(404).json({ message: "Form not found." });
  res.json({ form: formRow(form) });
});

// UPDATE FORM
app.put("/forms/:id", authenticateToken, (req, res) => {
  try {
    const form = ownedForm(req.params.id, req.user.email);
    if (!form) return res.status(404).json({ message: "Form not found." });

    if (form.published) {
      return res.status(409).json({
        message: "Unpublish the form before editing it.",
      });
    }

    const { title, description = "", fields } = req.body || {};

    if (typeof title !== "string" || !title.trim() ||
        title.length > 150 || typeof description !== "string" ||
        description.length > 2000) {
      return res.status(400).json({ message: "Invalid title or description." });
    }

    const normalizedFields = normalizeFields(fields);

    db.prepare(`
      UPDATE forms SET title = ?, description = ?, fields_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_email = ?
    `).run(
      title.trim(), description.trim(), JSON.stringify(normalizedFields),
      form.id, req.user.email
    );

    res.json({
      message: "Form updated.",
      form: formRow(db.prepare("SELECT * FROM forms WHERE id = ?").get(form.id)),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || "Update failed." });
  }
});

// PUBLISH
app.post("/forms/:id/publish", authenticateToken, (req, res) => {
  const form = ownedForm(req.params.id, req.user.email);
  if (!form) return res.status(404).json({ message: "Form not found." });

  db.prepare(`
    UPDATE forms SET published = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_email = ?
  `).run(form.id, req.user.email);

  res.json({
    message: "Form published!",
    shareUrl: `${FRONTEND_URL}/f/${form.slug}`,
  });
});

// UNPUBLISH
app.post("/forms/:id/unpublish", authenticateToken, (req, res) => {
  const form = ownedForm(req.params.id, req.user.email);
  if (!form) return res.status(404).json({ message: "Form not found." });

  db.prepare(`
    UPDATE forms SET published = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_email = ?
  `).run(form.id, req.user.email);

  res.json({ message: "Form unpublished." });
});

// DELETE FORM
app.delete("/forms/:id", authenticateToken, (req, res) => {
  const result = db.prepare(`
    DELETE FROM forms WHERE id = ? AND owner_email = ?
  `).run(req.params.id, req.user.email);

  if (!result.changes) {
    return res.status(404).json({ message: "Form not found." });
  }

  res.json({ message: "Form and responses deleted." });
});

// PUBLIC FORM
app.get("/public/forms/:slug", (req, res) => {
  const form = db.prepare(`
    SELECT title, description, slug, fields_json
    FROM forms WHERE slug = ? AND published = 1
  `).get(req.params.slug);

  if (!form) return res.status(404).json({ message: "Published form not found." });

  res.json({
    form: {
      title: form.title,
      description: form.description,
      slug: form.slug,
      fields: JSON.parse(form.fields_json),
    },
  });
});

// SUBMIT RESPONSE — EMAIL GOES TO THE FORM CREATOR
app.post("/public/forms/:slug/responses", async (req, res) => {
  try {
    const form = db.prepare(`
      SELECT * FROM forms WHERE slug = ? AND published = 1
    `).get(req.params.slug);

    if (!form) return res.status(404).json({ message: "Published form not found." });

    const fields = JSON.parse(form.fields_json);
    const answers = validateAnswers(fields, req.body?.answers);
    const respondentEmail = req.body?.respondentEmail;

    if (respondentEmail != null && !validEmail(respondentEmail)) {
      return res.status(400).json({ message: "Invalid respondent email." });
    }

    const id = crypto.randomUUID();

    // Persist the response before attempting email delivery.
    db.prepare(`
      INSERT INTO form_responses
        (id, form_id, answers_json, respondent_email)
      VALUES (?, ?, ?, ?)
    `).run(
      id,
      form.id,
      JSON.stringify(answers),
      respondentEmail?.trim().toLowerCase() || null
    );

    const answerHtml = fields.map((field) => `
      <h3>${escapeHtml(field.label)}</h3>
      <p>${escapeHtml(answers[field.id] || "Not answered").replace(/\n/g, "<br>")}</p>
    `).join("");

    try {
      await sendMail({
        // Sender is your Gmail SMTP account.
        to: form.owner_email,
        subject: `New response to your form: ${form.title}`,
        html: `
          <h2>You received a new form response!</h2>
          <p><b>Form:</b> ${escapeHtml(form.title)}</p>
          <p><b>Respondent email:</b> ${escapeHtml(respondentEmail || "Not provided")}</p>
          <p><b>Submitted:</b> ${new Date().toISOString()}</p>
          <hr />
          ${answerHtml}
          <hr />
          <p>Response ID: ${escapeHtml(id)}</p>
        `,
      });

      db.prepare(`
        UPDATE form_responses SET email_sent = 1, email_error = NULL WHERE id = ?
      `).run(id);

      return res.status(201).json({ message: "Response submitted successfully!" });
    } catch (error) {
      console.error("Response email failed:", error.message);

      db.prepare(`
        UPDATE form_responses SET email_error = ? WHERE id = ?
      `).run(error.message.slice(0, 500), id);

      return res.status(201).json({
        message: "Response saved, but the creator notification email failed.",
      });
    }
  } catch (error) {
    res.status(400).json({
      message: error.message || "Could not submit response.",
    });
  }
});

// VIEW RESPONSES
app.get("/forms/:id/responses", authenticateToken, (req, res) => {
  const form = ownedForm(req.params.id, req.user.email);
  if (!form) return res.status(404).json({ message: "Form not found." });

  const rows = db.prepare(`
    SELECT id, answers_json, respondent_email, submitted_at, email_sent
    FROM form_responses WHERE form_id = ?
    ORDER BY submitted_at DESC
  `).all(form.id);

  res.json({
    responses: rows.map((row) => ({
      id: row.id,
      answers: JSON.parse(row.answers_json),
      respondentEmail: row.respondent_email,
      submittedAt: row.submitted_at,
      emailSent: Boolean(row.email_sent),
    })),
  });
});

app.listen(PORT, () => {
  console.log(`AYM Forms API running at http://localhost:${PORT}`);
  console.log(`SQLite database: ${path.join(__dirname, "data", "app.db")}`);
});
