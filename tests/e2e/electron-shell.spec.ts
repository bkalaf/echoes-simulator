import { _electron as electron, expect, test } from "@playwright/test";

test("launches the isolated standalone desktop shell and navigates persisted-run surfaces", async () => {
  const rendererErrors: string[] = [];
  const application = await electron.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-seccomp-filter-sandbox", "--disable-gpu-sandbox", "--no-zygote", "."],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: "1" },
  });
  try {
    const page = await application.firstWindow();
    page.on("pageerror", (error) => rendererErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") rendererErrors.push(message.text());
    });
    await expect(page).toHaveTitle(/Echoes of Eidolon/i);
    await expect.poll(() => page.evaluate(() => typeof window.eidolonSimulator)).toBe("object");
    await expect.poll(() => page.evaluate(() => window.eidolonSimulator?.getRuntimeInfo())).toMatchObject({ version: "0.1.0" });
    await expect(page.getByRole("heading", { level: 1, name: "Runs" })).toBeVisible();
    await expect(page.getByText("Standalone operator console")).toBeVisible();

    await page.getByRole("button", { name: "RUN DIAGNOSTIC" }).click();
    await expect(page.getByRole("button", { name: "Running years 0–2000" })).toBeDisabled();
    await expect(page.getByText(/Diagnostic complete ·/)).toBeVisible({ timeout: 30_000 });

    for (const section of [
      "Setup & Preflight",
      "Live Dashboard",
      "World Browser",
      "Settlement Detail",
      "State Detail",
      "Institutions",
      "Timeline",
      "Naming Queue",
      "Export",
      "Diagnostics",
      "Runs",
    ]) {
      await page.getByRole("button", { name: section, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: section })).toBeVisible();
    }

    await page.getByRole("button", { name: "World Browser" }).click();
    await expect(page.getByLabel("Equirectangular Site plot")).toBeVisible();
    await page.getByRole("button", { name: "SCHISM", exact: true }).click();
    await expect(page.getByRole("button", { name: "SCHISM", exact: true })).toHaveClass(/active/);
    await expect(page.getByText("Canonical execution is fail-closed.")).toBeVisible();
    expect(rendererErrors).toEqual([]);
  } finally {
    await application.close();
  }
});
