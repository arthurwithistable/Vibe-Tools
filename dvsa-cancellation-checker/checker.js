require("dotenv").config();
const { chromium } = require("playwright");
const notifier = require("node-notifier");
const path = require("path");

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  licenceNumber: process.env.LICENCE_NUMBER || "",
  theoryTestNumber: process.env.THEORY_TEST_NUMBER || "",
  testCentre: process.env.TEST_CENTRE || "Goodmayes",
  checkIntervalMs: (parseInt(process.env.CHECK_INTERVAL_MINUTES) || 3) * 60_000,
  earliestDate: process.env.EARLIEST_DATE || null,
  latestDate: process.env.LATEST_DATE || null,
  preferredDays: process.env.PREFERRED_DAYS
    ? process.env.PREFERRED_DAYS.split(",").map((d) => d.trim().toLowerCase())
    : [],
  headless: process.env.HEADLESS === "true",
};

const URLS = {
  start: "https://driverpracticaltest.dvsa.gov.uk/application",
};

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-GB");
  console.log(`[${ts}] ${msg}`);
}

function alert(title, message) {
  log(`ALERT: ${title} - ${message}`);
  notifier.notify({
    title,
    message,
    sound: true,
    wait: true,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(minMs = 800, maxMs = 2000) {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

function isDateAcceptable(dateStr) {
  if (!dateStr) return false;

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;

  if (CONFIG.earliestDate) {
    const earliest = new Date(CONFIG.earliestDate);
    if (date < earliest) return false;
  }

  if (CONFIG.latestDate) {
    const latest = new Date(CONFIG.latestDate);
    if (date > latest) return false;
  }

  if (CONFIG.preferredDays.length > 0) {
    const dayName = DAY_NAMES[date.getDay()];
    if (!CONFIG.preferredDays.includes(dayName)) return false;
  }

  return true;
}

function getPageId(page) {
  return page.evaluate(() => document.body?.id || "");
}

// ─── Page Handlers ───────────────────────────────────────────────────────────

async function handleTestTypePage(page) {
  log("Selecting car test type...");
  await page.click("#test-type-car");
  await randomDelay();
  await page.click('input[id="test-type-submit"]');
  await page.waitForLoadState("networkidle");
}

async function handleLicencePage(page) {
  log("Entering driving licence number...");
  await page.fill("#driving-licence", CONFIG.licenceNumber);
  await randomDelay();

  // Select "No" for extended test
  const extendedNo = await page.$("#extended-test-no");
  if (extendedNo) {
    await extendedNo.click();
    await randomDelay();
  }

  // Select "No" for special needs
  const specialNo = await page.$("#special-needs-none");
  if (specialNo) {
    await specialNo.click();
    await randomDelay();
  }

  await page.click("#driving-licence-submit");
  await page.waitForLoadState("networkidle");
}

async function handlePreferencesPage(page) {
  log("Setting test preferences...");

  // Set preferred date to today or earliest date (so we get the soonest slots)
  const prefDate = CONFIG.earliestDate || new Date().toISOString().split("T")[0];

  const calendarInput = await page.$("#test-choice-calendar");
  if (calendarInput) {
    await calendarInput.fill(prefDate);
    await randomDelay();
  }

  await page.click('input[value="Continue"]');
  await page.waitForLoadState("networkidle");
}

async function handleTestCentreSearchPage(page) {
  log(`Searching for test centre: ${CONFIG.testCentre}...`);

  // Enter postcode/centre name to search
  await page.fill("#test-centres-input", CONFIG.testCentre);
  await randomDelay();
  await page.click("#test-centres-submit");
  await page.waitForLoadState("networkidle");
}

async function handleTestCentrePage(page) {
  log("Checking calendar for available dates...");

  // Look for the target test centre in results
  const centreLinks = await page.$$("a.test-centre-details-link");
  let targetCentre = null;

  for (const link of centreLinks) {
    const text = await link.textContent();
    if (text.toLowerCase().includes(CONFIG.testCentre.toLowerCase())) {
      targetCentre = link;
      break;
    }
  }

  if (!targetCentre && centreLinks.length > 0) {
    // If we can't find exact match, use the first result
    targetCentre = centreLinks[0];
    const text = await targetCentre.textContent();
    log(`Exact centre not found. Using first result: ${text.trim()}`);
  }

  // Check for bookable dates on the calendar
  const bookableDates = await page.$$("td.BookingCalendar-date--bookable");

  if (bookableDates.length === 0) {
    log("No available dates found on calendar.");
    return false;
  }

  log(`Found ${bookableDates.length} bookable date(s) on calendar.`);

  // Check each bookable date against our criteria
  for (const dateCell of bookableDates) {
    const dateLink = await dateCell.$("a.BookingCalendar-dateLink");
    if (!dateLink) continue;

    // Extract the date from the link's data or text
    const href = await dateLink.getAttribute("href");
    const dateText = await dateLink.getAttribute("data-date");
    const dayText = await dateCell.$eval(
      ".BookingCalendar-day",
      (el) => el.textContent
    ).catch(() => "");

    // Try to extract date from various attributes
    let dateValue = dateText;
    if (!dateValue && href) {
      // Try to parse date from the URL
      const match = href.match(/(\d{4}-\d{2}-\d{2})/);
      if (match) dateValue = match[1];
    }

    log(`  Available date: ${dateValue || dayText || "unknown"}`);

    if (dateValue && !isDateAcceptable(dateValue)) {
      log(`  Skipping - doesn't match date/day criteria.`);
      continue;
    }

    // Found an acceptable date!
    log(`  MATCH FOUND! Clicking date: ${dateValue || dayText}`);
    alert(
      "DVSA Slot Found!",
      `Available date: ${dateValue || dayText}. Proceeding to book...`
    );

    await dateLink.click();
    await page.waitForLoadState("networkidle");
    return true;
  }

  log("Available dates found but none match your criteria.");
  return false;
}

async function handleTimeSlotPage(page) {
  log("Selecting time slot...");

  // Get all available time slots
  const slots = await page.$$('input[name="slotTime"]');

  if (slots.length === 0) {
    log("No time slots available on this page.");
    return false;
  }

  // Select the first available slot
  const firstSlot = slots[0];
  const slotValue = await firstSlot.getAttribute("value");
  log(`Selecting time slot: ${slotValue}`);

  await firstSlot.click();
  await randomDelay();

  // Handle any warning dialogs
  const warningContinue = await page.$("#slot-warning-continue");
  if (warningContinue) {
    await warningContinue.click();
    await randomDelay();
  }

  // Submit slot selection
  const submitBtn = await page.$("#slot-chosen-submit");
  if (submitBtn) {
    await submitBtn.click();
    await page.waitForLoadState("networkidle");
  }

  return true;
}

async function handleDetailsPage(page) {
  // We've reached the details/payment page - STOP HERE
  log("═══════════════════════════════════════════════════════════");
  log("  SLOT RESERVED! You have ~15 minutes to complete payment.");
  log("  Please fill in your details and pay in the browser window.");
  log("═══════════════════════════════════════════════════════════");

  alert(
    "SLOT RESERVED - ACTION REQUIRED!",
    "A driving test slot has been reserved! Complete your details and payment in the browser within 15 minutes."
  );

  // Play repeated alerts
  for (let i = 0; i < 10; i++) {
    await sleep(30_000);
    alert(
      "REMINDER - Complete Payment!",
      `${15 - (i + 1) * 0.5} minutes remaining to complete your booking.`
    );
  }
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

async function run() {
  // Validate config
  if (!CONFIG.licenceNumber) {
    console.error("ERROR: LICENCE_NUMBER is required. Set it in .env file.");
    process.exit(1);
  }

  log("DVSA Driving Test Cancellation Checker");
  log("══════════════════════════════════════");
  log(`Test Centre: ${CONFIG.testCentre}`);
  log(`Check Interval: ${CONFIG.checkIntervalMs / 60_000} minutes`);
  log(
    `Date Range: ${CONFIG.earliestDate || "any"} to ${CONFIG.latestDate || "any"}`
  );
  log(
    `Preferred Days: ${CONFIG.preferredDays.length ? CONFIG.preferredDays.join(", ") : "any"}`
  );
  log(`Headless: ${CONFIG.headless}`);
  log("");

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  let attempt = 0;
  let slotBooked = false;

  while (!slotBooked) {
    attempt++;
    log(`\n── Attempt #${attempt} ──────────────────────────────`);

    try {
      // Navigate to booking start page
      await page.goto(URLS.start, { waitUntil: "networkidle", timeout: 30000 });
      await randomDelay(1000, 2000);

      // Check if there's a CAPTCHA or challenge page
      const pageContent = await page.content();
      if (
        pageContent.includes("captcha") ||
        pageContent.includes("challenge") ||
        pageContent.includes("Checking your browser")
      ) {
        log(
          "CAPTCHA or browser challenge detected. Please solve it manually in the browser window."
        );
        alert(
          "CAPTCHA Required",
          "Please solve the CAPTCHA in the browser window."
        );

        // Wait for user to solve CAPTCHA (up to 5 minutes)
        await page.waitForFunction(
          () => {
            const bodyId = document.body?.id;
            return (
              bodyId &&
              (bodyId.includes("page-") || bodyId.includes("application"))
            );
          },
          { timeout: 300_000 }
        );

        log("CAPTCHA solved! Continuing...");
        await randomDelay(1000, 2000);
      }

      // Process each page of the booking flow
      let maxSteps = 20; // Safety limit
      while (maxSteps-- > 0) {
        const pageId = await getPageId(page);
        log(`Current page: ${pageId || "unknown"}`);

        switch (pageId) {
          case "page-choose-test-type":
            await handleTestTypePage(page);
            break;

          case "page-driving-licence-number":
            await handleLicencePage(page);
            break;

          case "page-test-preferences":
            await handlePreferencesPage(page);
            break;

          case "page-test-centre-search":
            await handleTestCentreSearchPage(page);
            break;

          case "page-test-centre":
            const found = await handleTestCentrePage(page);
            if (!found) {
              log(
                `No matching slots. Waiting ${CONFIG.checkIntervalMs / 1000}s before retry...`
              );
              await sleep(CONFIG.checkIntervalMs);

              // Reload the page to check again
              await page.reload({ waitUntil: "networkidle" });

              // Check if session expired (redirected to start)
              const newPageId = await getPageId(page);
              if (
                newPageId !== "page-test-centre" &&
                newPageId !== "page-test-centre-search"
              ) {
                log("Session may have expired. Restarting booking flow...");
                break;
              }
              continue;
            }
            break;

          case "page-available-time":
            const slotSelected = await handleTimeSlotPage(page);
            if (!slotSelected) {
              log("Failed to select time slot. Going back...");
              await page.goBack({ waitUntil: "networkidle" });
              continue;
            }
            break;

          case "page-your-details":
            await handleDetailsPage(page);
            slotBooked = true;
            break;

          default:
            // Unknown page - might be an error or redirect
            log(`Unknown page: "${pageId}". Checking for errors...`);

            const errorMsg = await page
              .$eval(".error-summary, .validation-summary-errors", (el) =>
                el.textContent.trim()
              )
              .catch(() => null);

            if (errorMsg) {
              log(`Error on page: ${errorMsg.substring(0, 200)}`);
            }

            // If we're on the start page URL, the session might have expired
            const url = page.url();
            if (
              url.includes("/application") &&
              !pageId.startsWith("page-")
            ) {
              log("Appears to be on initial/challenge page. Waiting...");
              await sleep(5000);

              // Check again
              const recheckId = await getPageId(page);
              if (!recheckId.startsWith("page-")) {
                log("Still not on a booking page. Restarting...");
                break;
              }
            }
            break;
        }

        if (slotBooked) break;

        // Small delay between pages
        await randomDelay(500, 1500);
      }
    } catch (err) {
      log(`Error during attempt #${attempt}: ${err.message}`);

      // Take a screenshot for debugging
      const screenshotPath = path.join(
        __dirname,
        `error-attempt-${attempt}.png`
      );
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      log(`Screenshot saved: ${screenshotPath}`);

      // Check if it's a timeout (page took too long) - just retry
      if (
        err.message.includes("Timeout") ||
        err.message.includes("timeout")
      ) {
        log("Timeout error. Will retry...");
      }
    }

    if (!slotBooked) {
      log(`Waiting ${CONFIG.checkIntervalMs / 1000}s before next attempt...`);
      await sleep(CONFIG.checkIntervalMs);
    }
  }

  log("\nScript finished. Browser will remain open.");
  // Keep browser open so user can complete payment
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
