import { expect, test as setup } from "@playwright/test";

import { E2E_PASSWORD, E2E_USERNAME, STORAGE_STATE } from "./auth-constants";

/**
 * Inicia sesión una vez y guarda la cookie para el resto de suites, que dan
 * por hecho que ya estás dentro. El acceso en sí se prueba aparte, en
 * `auth.spec.ts`, sin este estado.
 */
setup("iniciar sesión", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USERNAME);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: STORAGE_STATE });
});
