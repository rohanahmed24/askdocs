import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "e2e-password-2026";
const RUN = Date.now();
const NO_ANSWER = "I could not find that in your documents.";

async function signUp(page: Page, who: string, org: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(`E2E ${who}`);
  await page.getByLabel("Email").fill(`e2e-${who}-${RUN}@askdocs.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Organization name").fill(org);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/documents$/);
}

async function ask(page: Page, question: string) {
  const box = page.getByLabel("Ask a question about your documents");
  await box.fill(question);
  await box.press("Enter");
}

const fakeCalls = async (page: Page) => (await (await page.request.get("http://127.0.0.1:4010/__stats")).json()) as { embeddings: number; chat: number };

async function newUser(browser: Browser, who: string, org: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, who, org);
  return { context, page };
}

// The whole product in a browser, with the AI service replaced by a local stand-in.
test.describe.serial("AskDocs", () => {
  test("a new user uploads a document, asks about it and gets a cited answer", async ({ page }) => {
    await signUp(page, "alice", "Alice Studio");
    await expect(page.getByRole("heading", { name: "Upload your first document" })).toBeVisible();

    // A file type that is not supported is refused with a sentence, before anything is sent.
    await page.locator("input[type=file]").setInputFiles({ name: "slides.docx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    await expect(page.getByRole("alert").filter({ hasText: "slides.docx: Upload a txt, md or pdf file." })).toBeVisible();

    await page.locator("input[type=file]").setInputFiles({
      name: "pricing.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("The Pro plan costs 29 dollars per user per month, billed yearly.\n\nStudents get 50 percent off the Pro plan with a valid university email."),
    });
    // The worker indexes it in the background and the page updates without a reload.
    await expect(page.getByText("Ready", { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText("pricing.txt").filter({ visible: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Chat" }).first().click();
    await expect(page.getByText("1 document ready")).toBeVisible();
    await ask(page, "How much does the Pro plan cost?");

    await expect(page.getByText(/29 dollars/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Source 1" })).toBeVisible();
    const sources = page.getByRole("complementary", { name: "Sources" });
    await expect(sources.getByText("1 passage cited")).toBeVisible();
    await expect(sources.getByText("pricing.txt")).toBeVisible();
  });

  test("a question the documents cannot answer gets the no-answer sentence and no model call", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(`e2e-alice-${RUN}@askdocs.test`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/documents$/);
    await page.goto("/chat");
    // Earlier messages are still there after a sign-in.
    await expect(page.getByText("How much does the Pro plan cost?")).toBeVisible();

    const before = await fakeCalls(page);
    await ask(page, "zzzz qqqq xxxx wwww");
    await expect(page.getByText(NO_ANSWER)).toBeVisible();
    expect((await fakeCalls(page)).chat).toBe(before.chat);
  });

  test("another organization cannot see the document or get answers from it", async ({ browser, page }) => {
    const bob = await newUser(browser, "bob", "Bob Studio");
    await bob.page.goto("/documents");
    await expect(bob.page.getByRole("heading", { name: "Upload your first document" })).toBeVisible();
    await expect(bob.page.getByText("pricing.txt")).toHaveCount(0);

    await bob.page.goto("/chat");
    await expect(bob.page.getByText("No document is ready yet.")).toBeVisible();
    const before = await fakeCalls(page);
    await ask(bob.page, "How much does the Pro plan cost?");
    await expect(bob.page.getByText(NO_ANSWER)).toBeVisible();
    expect(bob.page.getByText(/29 dollars/)).toHaveCount(0);
    expect((await fakeCalls(page)).chat).toBe(before.chat); // nothing of Alice's was sent to the model
    await bob.context.close();
  });

  test("deleting a document removes it and gives its storage back", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(`e2e-alice-${RUN}@askdocs.test`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/documents$/);

    await page.getByRole("button", { name: "Delete pricing.txt" }).filter({ visible: true }).click();
    await page.getByRole("group", { name: "Delete pricing.txt?" }).filter({ visible: true }).getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Upload your first document" })).toBeVisible();
    await expect(page.getByText("0 B of 50 MB")).toBeVisible();
  });
});
