require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");

/* ===========================
   ENV
=========================== */

const API_KEY = process.env.ELEVENLABS_API_KEY;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

if (!API_KEY) {
  throw new Error("ELEVENLABS_API_KEY missing");
}

if (!SHEET_ID) {
  throw new Error("GOOGLE_SHEET_ID missing");
}

/* ===========================
   GOOGLE SERVICE ACCOUNT
=========================== */

const serviceAccountPath = path.join(
  "/tmp",
  "service-account.json"
);

const serviceAccountEnv =
  process.env.GOOGLE_SERVICE_ACCOUNT;

if (!serviceAccountEnv) {
  throw new Error(
    "GOOGLE_SERVICE_ACCOUNT env missing"
  );
}

if (!fs.existsSync(serviceAccountPath)) {
  fs.writeFileSync(
    serviceAccountPath,
    serviceAccountEnv
  );
}

const auth = new google.auth.GoogleAuth({
  keyFile: serviceAccountPath,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

/* ===========================
   EXTRACT DATA
=========================== */

function extractData(text) {
  if (!text) return null;

  const lower = text.toLowerCase();

  const ignoreWords = [
    "thank",
    "thanks",
    "yeah",
    "yes",
    "hello",
    "hi",
    "interested",
    "callback",
    "visa",
    "work",
    "student",
    "pr",
    "india",
    "australia",
    "client",
    "agent",
    "growmore",
    "immigration",
    "temporary",
    "correct",
    "details",
  ];

  /* -------------------------
     EMAIL
  ------------------------- */

  let client_email = "";

  const emailMatch = text.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  );

  if (emailMatch) {
    client_email =
      emailMatch[0].toLowerCase();
  }

  /* spoken email */

  if (!client_email) {
    const spoken =
      lower.match(
        /([a-z0-9._%+-]+)\s+(?:at|at the rate)\s+([a-z0-9.-]+)\s+(?:dot|\.)\s+([a-z]{2,10})/i
      );

    if (spoken) {
      client_email =
        `${spoken[1]}@${spoken[2]}.${spoken[3]}`
          .replace(/\s/g, "")
          .toLowerCase();
    }
  }

  /* -------------------------
     PHONE
  ------------------------- */

  let client_phone = "";

  const phones =
    text.match(
      /\+?\d[\d\s()-]{8,20}\d/g
    ) || [];

  for (const p of phones) {
    const clean =
      p.replace(/\D/g, "");

    if (
      clean.length >= 10 &&
      clean.length <= 15
    ) {
      client_phone = clean;
      break;
    }
  }

  /* -------------------------
     NAME
  ------------------------- */

  let client_name = "";

  const patterns = [
    /my name is\s+([a-z ]+)/i,
    /i am\s+([a-z ]+)/i,
    /this is\s+([a-z ]+)/i,
    /name\s*:\s*([a-z ]+)/i,
    /name is\s+([a-z ]+)/i,
  ];

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      const candidate =
        match[1]
          .trim()
          .replace(/\s+/g, " ");

      const invalid =
        candidate
          .toLowerCase()
          .split(" ")
          .some(word =>
            ignoreWords.includes(word)
          );

      if (
        candidate.length > 2 &&
        !invalid
      ) {
        client_name = candidate;
        break;
      }
    }
  }

  /* fallback from email */

  if (
    !client_name &&
    client_email
  ) {
    const fallback =
      client_email
        .split("@")[0]
        .replace(/[0-9._-]/g, "");

    if (
      fallback.length >= 3 &&
      !ignoreWords.includes(
        fallback.toLowerCase()
      )
    ) {
      client_name =
        fallback;
    }
  }

  /* capitalize */

  client_name = client_name
    .split(" ")
    .filter(Boolean)
    .map(
      word =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");

  /* -------------------------
     COUNTRY
  ------------------------- */

  let caller_country = "";

  if (
    lower.includes("india")
  ) {
    caller_country = "india";
  }

  if (
    lower.includes("australia")
  ) {
    caller_country =
      "australia";
  }

  /* -------------------------
     INQUIRY
  ------------------------- */

  let inquiry =
    "general inquiry";

  if (
    /pr|189|190|491|pathway/i.test(
      lower
    )
  ) {
    inquiry =
      "pr pathways";
  } else if (
    /work|482|186/i.test(
      lower
    )
  ) {
    inquiry =
      "work visa";
  } else if (
    /student/i.test(
      lower
    )
  ) {
    inquiry =
      "student visa";
  } else if (
    /visitor|600/i.test(
      lower
    )
  ) {
    inquiry =
      "visitor visa";
  }

  /* -------------------------
     NEXT STEP
  ------------------------- */

  let next_step_taken =
    "follow_up_required";

  if (
    /callback|free callback/i.test(
      lower
    )
  ) {
    next_step_taken =
      "free_callback";
  }

  if (
    /paid consultation|payment|paid/i.test(
      lower
    )
  ) {
    next_step_taken =
      "paid_consultation";
  }

  /* -------------------------
     VALIDATION
  ------------------------- */

  const hasLead =
    client_name ||
    client_email ||
    client_phone;

  if (!hasLead) {
    return null;
  }

  return {
    caller_type:
      "new_client",
    client_name,
    client_email,
    client_phone,
    inquiry,
    next_step_taken,
    caller_country,
  };
}

/* ===========================
   GOOGLE SHEETS
=========================== */

async function appendToSheet(data) {
  const client =
    await auth.getClient();

  const sheets =
    google.sheets({
      version: "v4",
      auth: client,
    });

  await sheets.spreadsheets.values.append({
    spreadsheetId:
      SHEET_ID,
    range:
      "Sheet1!A:G",
    valueInputOption:
      "RAW",
    requestBody: {
      values: [[
        data.caller_type,
        data.client_name,
        data.client_email,
        data.client_phone,
        data.inquiry,
        data.next_step_taken,
        data.caller_country,
      ]],
    },
  });

  console.log(
    "✅ Saved to sheet"
  );
}

/* ===========================
   ELEVENLABS API
=========================== */

async function getConversation(
  conversationId
) {
  const res =
    await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
      {
        headers: {
          "xi-api-key":
            API_KEY,
        },
      }
    );

  return res.data;
}

