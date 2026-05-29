require("dotenv").config();

const axios = require("axios");
const { google } = require("googleapis");

/* ===========================
   ENV
=========================== */

const API_KEY =
  process.env.ELEVENLABS_API_KEY;

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID;

if (!API_KEY) {
  throw new Error(
    "ELEVENLABS_API_KEY missing"
  );
}

if (!SHEET_ID) {
  throw new Error(
    "GOOGLE_SHEET_ID missing"
  );
}

if (
  !process.env
    .GOOGLE_SERVICE_ACCOUNT
) {
  throw new Error(
    "GOOGLE_SERVICE_ACCOUNT missing"
  );
}

/* ===========================
   GOOGLE SERVICE ACCOUNT
=========================== */

const credentials =
  JSON.parse(
    process.env
      .GOOGLE_SERVICE_ACCOUNT
  );

const auth =
  new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });

/* ===========================
   EXTRACT DATA
=========================== */
function extractData(text) {
  if (!text) return null;

  const lower =
    text.toLowerCase();

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

  let client_email =
    "";

  const emailMatch =
    text.match(
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

  let client_phone =
    "";

  const phones =
    text.match(
      /\+?\d[\d\s()-]{8,20}\d/g
    ) || [];

  for (const p of phones) {
    const clean =
      p.replace(/\D/g, "");

    if (
      clean.length >=
        10 &&
      clean.length <=
        15
    ) {
      client_phone =
        clean;
      break;
    }
  }

  /* -------------------------
     CLIENT TYPE
  ------------------------- */

  let client_type =
    "new_client";

  if (
    /existing|already applied|follow up|returning|old client|existing case/i.test(
      lower
    )
  ) {
    client_type =
      "existing_client";
  }

  /* -------------------------
     NAME
  ------------------------- */

  let client_name =
    "";

  const patterns = [
    /my name is\s+([a-z]+(?:\s[a-z]+){0,3})/i,
    /i am\s+([a-z]+(?:\s[a-z]+){0,3})/i,
    /this is\s+([a-z]+(?:\s[a-z]+){0,3})/i,
    /name\s*:\s*([a-z]+(?:\s[a-z]+){0,3})/i,
    /name is\s+([a-z]+(?:\s[a-z]+){0,3})/i,

    // transcript summary support
    /the user[,]?\s+([a-z]+(?:\s[a-z]+){0,3})/i,
    /user[,]?\s+([a-z]+(?:\s[a-z]+){0,3})/i,

    // "Ajay Gaur from India"
    /([a-z]+(?:\s[a-z]+){1,3})\s+from\s+[a-z]+/i,
  ];

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      const candidate =
        match[1]
          .trim()
          .replace(
            /\s+/g,
            " "
          );

      const invalid =
        candidate
          .toLowerCase()
          .split(" ")
          .some(word =>
            ignoreWords.includes(
              word
            )
          );

      if (
        candidate.length >
          2 &&
        !invalid
      ) {
        client_name =
          candidate;
        break;
      }
    }
  }

  /* fallback from email */

  if (
    !client_name &&
    client_email
  ) {
    client_name =
      client_email
        .split("@")[0]
        .replace(
          /[0-9._-]/g,
          " "
        );
  }

  /* capitalize */

  client_name =
    client_name
      .split(" ")
      .filter(Boolean)
      .map(
        word =>
          word.charAt(
            0
          )
            .toUpperCase() +
          word
            .slice(1)
            .toLowerCase()
      )
      .join(" ");

  /* -------------------------
     COUNTRY
  ------------------------- */

  let caller_country =
    "";

  const countryMatch =
    text.match(
      /\bfrom\s+([a-z\s]+?)(?:[.,]|$|\s(?:for|to|and))/i
    );

  if (countryMatch?.[1]) {
    caller_country =
      countryMatch[1]
        .trim()
        .toLowerCase();
  }

  /* -------------------------
     MIGRATION SUMMARY
  ------------------------- */

  let migration_intent_summary =
    "";

  const migrationMatch =
    text.match(
      /(looking for|seeking|interested in|want|need|applying for|regarding)\s+(.+?)(?:[.,]|$)/i
    );

  if (migrationMatch?.[2]) {
    migration_intent_summary =
      migrationMatch[2]
        .trim();
  }

  /* -------------------------
     NEXT STEP
  ------------------------- */

  let next_step_taken =
    "";

  if (
    /callback|call back|call me back|free callback/i.test(
      lower
    )
  ) {
    next_step_taken =
      "free_callback";
  }

  if (
    /paid consultation|consultation|payment|paid/i.test(
      lower
    )
  ) {
    next_step_taken =
      "paid_consultation";
  }

  const hasLead =
    client_name ||
    client_email ||
    client_phone;

  if (!hasLead) {
    return null;
  }

  return {
    client_type,
    client_name,
    client_email,
    client_phone,
    migration_intent_summary,
    next_step_taken,
    caller_country,
  };
}


/* ===========================
   GOOGLE SHEETS
=========================== */

async function appendToSheet(
  data
) {
  try {
    console.log(
      "========== GOOGLE SHEET DEBUG =========="
    );

    console.log(
      "Spreadsheet ID:",
      SHEET_ID
    );

    console.log(
      "Service Account:",
      credentials.client_email
    );

    const client =
      await auth.getClient();

    console.log(
      "Google Auth Success"
    );

    const sheets =
      google.sheets({
        version: "v4",
        auth: client,
      });

    const values = [[
      data.client_type ||
        "",
      data.client_name ||
        "",
      data.client_email ||
        "",
      data.client_phone ||
        "",
      data.migration_intent_summary ||
        "",
      data.next_step_taken ||
        "",
      data.caller_country ||
        "",
    ]];

    console.log(
      "Values:",
      values
    );

    const response =
      await sheets.spreadsheets.values.append(
        {
          spreadsheetId:
            SHEET_ID,

          // START FROM ROW 2 (AFTER HEADERS IN ROW 1)
          range:
            "Sheet1!A2:G",

          valueInputOption:
            "USER_ENTERED",

          // APPEND WITHOUT SHIFTING EXISTING DATA
          insertDataOption:
            "OVERWRITE",

          requestBody: {
            values,
          },
        }
      );

    console.log(
      "✅ Saved to Google Sheet"
    );

    console.log(
      response.data
    );

    return response.data;
  } catch (error) {
    console.error(
      "❌ GOOGLE SHEET ERROR"
    );

    console.error(
      "Message:",
      error.message
    );

    console.error(
      "Response:",
      error.response
        ?.data
    );

    console.error(
      "Errors:",
      error.errors
    );

    throw error;
  }
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

/* ===========================
   MAIN API HANDLER
=========================== */

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method Not Allowed",
    });
  }

  try {
    console.log("Incoming body:", req.body);

    const body = req.body;

    let extractedData = null;

    /* ===========================
       1. DIRECT POSTMAN DATA
    =========================== */

    if (
      body.client_name ||
      body.client_email ||
      body.client_phone
    ) {
      extractedData = {
        client_type:
          body.client_type || "new_client",

        client_name:
          body.client_name || "",

        client_email:
          body.client_email || "",

        client_phone:
          body.client_phone || "",

        migration_intent_summary:
          body.migration_intent_summary ||
          "general inquiry",

        next_step_taken:
          body.next_step_taken ||
          "follow_up_required",

        caller_country:
          body.caller_country || "",
      };
    }

    /* ===========================
       2. ELEVENLABS WEBHOOK
    =========================== */

    else if (
      body.type === "post_call_transcription" &&
      body.data
    ) {
      const transcriptArray =
        body.data.transcript || [];

      const transcript =
        transcriptArray
          .map(item => item.message)
          .join(" ");

      console.log(
        "Transcript:",
        transcript
      );

      extractedData =
        extractData(transcript);

      if (extractedData) {
        extractedData.client_type =
          extractedData.client_type ||
          "new_client";
      }
    }

    /* ===========================
       NO DATA FOUND
    =========================== */

    if (!extractedData) {
      return res.status(400).json({
        success: false,
        error:
          "No valid lead data found",
      });
    }

    await appendToSheet(
      extractedData
    );

    return res.status(200).json({
      success: true,
      message:
        "Lead saved successfully",
      data: extractedData,
    });
  } catch (error) {
    console.error(
      "API Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
