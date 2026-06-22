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

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/* ===========================
   EXTRACT DATA
=========================== */

function extractData(text) {
  if (!text) return null;

  const lower =
    text.toLowerCase();

  const extraction_date =
    formatDate(new Date());

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
    /existing client|existing case|already applied|follow(?:[-\s]up)|returning client|already have a case|worked with you|with you before|existing customer/i.test(
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

  const namePatterns = [
    // name (Riddhi Upadhyay)
    /name\s*\(([^)]+)\)/i,

    // my name is riddhi
    /my name is\s+([a-z]+(?:\s[a-z]+){0,2})/i,

    // i am riddhi
    /i am\s+([a-z]+(?:\s[a-z]+){0,2})/i,

    // this is riddhi
    /this is\s+([a-z]+(?:\s[a-z]+){0,2})/i,

    // user riddhi
    /user[,:\s]+([a-z]+(?:\s[a-z]+){0,2})/i,

    // riddhi from india
    /([a-z]+(?:\s[a-z]+){0,2})\s+from\s+[a-z]+/i,
  ];

  for (const pattern of namePatterns) {
    const match =
      text.match(pattern);

    if (match?.[1]) {
      client_name =
        match[1]
          .trim()
          .replace(
            /\s+/g,
            " "
          );

      break;
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
          word.charAt(0)
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
      /from\s+([A-Za-z\s]+?)(?:[.,]|$|\s(?:seeking|contacted|for))/i
    );

  if (countryMatch?.[1]) {
    caller_country =
      countryMatch[1]
        .trim()
        .toLowerCase();
  }

  /* fallback */

  if (!caller_country) {
    if (
      lower.includes(
        "india"
      )
    ) {
      caller_country =
        "india";
    } else if (
      lower.includes(
        "australia"
      )
    ) {
      caller_country =
        "australia";
    }
  }

  /* -------------------------
     MIGRATION SUMMARY
  ------------------------- */

  let migration_intent_summary =
    "";

  const visaMatch =
    text.match(
      /(visitor visa|student visa|work visa|tourist visa|dependent visa|pr|permanent residency)/i
    );

  if (visaMatch?.[1]) {
    migration_intent_summary =
      visaMatch[1]
        .trim()
        .toLowerCase();
  }

  /* -------------------------
     NEXT STEP
  ------------------------- */

  let next_step_taken =
    "follow_up_required";

  if (
    /free callback|callback|call back|call me back/i.test(
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
     VALIDATE LEAD
  ------------------------- */

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
    date: extraction_date,
  };
}

/* ===========================
   GOOGLE SHEETS
=========================== */

async function appendToSheet(
  data
) {
  try {
    const client =
      await auth.getClient();

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
      data.date ||
        "",
    ]];

    await sheets.spreadsheets.values.append(
      {
        spreadsheetId:
          SHEET_ID,
        range:
          "Sheet1!A2:H",
        valueInputOption:
          "USER_ENTERED",
        insertDataOption:
          "INSERT_ROWS",
        requestBody: {
          values,
        },
      }
    );

    console.log(
      "✅ Saved to Google Sheet"
    );
  } catch (error) {
    console.error(
      "❌ GOOGLE SHEET ERROR:",
      error.message
    );

    throw error;
  }
}

/* ===========================
   MAIN API HANDLER
=========================== */

module.exports =
  async function handler(
    req,
    res
  ) {
    if (
      req.method !==
      "POST"
    ) {
      return res
        .status(405)
        .json({
          success: false,
          error:
            "Method Not Allowed",
        });
    }

    try {
      console.log(
        "Incoming body:",
        req.body
      );

      const body =
        req.body;

      let extractedData =
        null;

      /* ===========================
         DIRECT DATA
      =========================== */

      if (
        body.client_name ||
        body.client_email ||
        body.client_phone
      ) {
        extractedData = {
          client_type:
            body.client_type ||
            "new_client",

          client_name:
            body.client_name ||
            "",

          client_email:
            body.client_email ||
            "",

          client_phone:
            body.client_phone ||
            "",

          migration_intent_summary:
            body.migration_intent_summary ||
            "",

          next_step_taken:
            body.next_step_taken ||
            "follow_up_required",

          caller_country:
            body.caller_country ||
            "",

          date:
            body.date ||
            formatDate(new Date()),
        };
      }

      /* ===========================
         ELEVENLABS WEBHOOK
      =========================== */

      else if (
        body.type ===
          "post_call_transcription" &&
        body.data
      ) {
        const transcriptArray =
          body.data
            .transcript ||
          [];

        // ONLY USER MESSAGES
        const transcript =
          transcriptArray
            .filter(
              item =>
                item.role ===
                "user"
            )
            .map(
              item =>
                item.message
            )
            .join(" ");

        console.log(
          "Transcript:",
          transcript
        );

        extractedData =
          extractData(
            transcript
          );
      }

      /* ===========================
         NO DATA FOUND
      =========================== */

      if (
        !extractedData
      ) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "No valid lead data found",
          });
      }

      await appendToSheet(
        extractedData
      );

      return res
        .status(200)
        .json({
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

      return res
        .status(500)
        .json({
          success: false,
          error:
            error.message,
        });
    }
  };