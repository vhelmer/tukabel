import { expect } from '@playwright/test';
import { authoredTest as test, openEditor } from './editorFixture';
import { object } from './helpers';

test('Dev Mode test start opens the crypt with every item and the chosen story flag', async ({
  page,
  workspace,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page, workspace.url);
  await page
    .getByRole('button', { name: 'Testovací start', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Testovací start' });
  await panel.getByLabel('Lokace', { exact: true }).selectOption('scene12');
  await expect(
    panel.getByRole('heading', { name: /Předměty v inventáři \(26\/26\)/u }),
  ).toBeVisible();
  await panel.getByLabel('Filtrovat příznaky', { exact: true }).fill('crypt');
  await panel
    .getByRole('group', { name: 'Příznaky' })
    .getByLabel('crypt-open')
    .check();
  await panel.getByRole('button', { name: 'Spustit test ↗' }).click();
  await expect(await object(page, 'Autobatéria')).toHaveCount(1);
  // Touch layouts page the inventory; the first items are always on screen.
  await expect(page.locator('[data-inventory-id="empty-bottle"]')).toHaveCount(
    1,
  );
  await expect(page.locator('[data-inventory-id="tape"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
