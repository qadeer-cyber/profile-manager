import fs from 'node:fs';
// Explicit distribution policy fixed in package metadata, never an environment switch.
const metadata = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const isOwnerEdition = metadata.name === 'azwah-multi-browser-owner' && metadata.azwahEdition === 'owner-personal' && metadata.azwahLicensePolicy === 'personal-no-activation';
export const isUltimateEdition = metadata.name === 'azwah-multi-browser-ultimate' && metadata.azwahEdition === 'ultimate';
export const isProvisionedOffice = metadata.azwahEdition === 'provisioned-office';
export const productName = isUltimateEdition ? (metadata.azwahProductName === 'AZWAH' ? 'AZWAH' : 'Azwah Multi Browser Ultimate') : isOwnerEdition ? 'Azwah Multi Browser Owner' : isProvisionedOffice ? 'Azwah Multi Browser Office' : 'Azwah Multi Browser';
