import fs from 'node:fs';
// Packaging metadata, never an environment-variable licensing bypass.
const metadata = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const isRestrictedPreview = metadata.azwahEdition === 'restricted-preview';
export const productName = isRestrictedPreview ? 'Azwah Multi Browser Preview' : 'Azwah Multi Browser';
