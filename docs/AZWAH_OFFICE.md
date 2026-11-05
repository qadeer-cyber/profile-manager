# Azwah Multi Browser — Office Edition

This separate edition starts from Ultimate 3.0 PR #9 at fb0a597. The protected runtime source remains 989dd04, with strict parity 69.8%. Office additions do not promote historical features.

## Upgrade identity

The displayed product, windows, UI, shortcut and installer artifact names are Azwah Multi Browser. The package name profile-manager, application ID local.profilemanager.app, application-data directory profile-manager and database migrations remain intact. Existing data is adopted in place. A versioned adoption receipt is written atomically without copying or rewriting profile, credential, extension or backup files. PM_USER_DATA remains an explicit isolation override. The installer retains deleteAppDataOnUninstall=false. A source test hashes legacy data before and after adoption. Real Windows 10 installed-upgrade acceptance remains required.

## Activation and administration

The employee application verifies Ed25519 licenses for product azwah-multi-browser-office. The device code is a domain-separated SHA-256 hash of Windows MachineGuid (or the supported host's OS installation identity). Raw hardware/OS IDs never leave the device through activation. Licenses contain device code, label, issue/expiry timestamps, status and license ID. They contain no cookies, browser state or proxy secrets. Verification is local and offline.

Azwah License Admin is a separate CLI under scripts/license-admin, excluded from the employee package allowlist. The administrator initializes an AES-256-GCM vault with a passphrase of at least 14 characters. A fixed-cost scrypt KDF protects its Ed25519 private key, issued-license records and audit log. Exclusive file locks serialize administrative mutations. Issuance, replacement and export require vault authentication. Private keys are never printed. Public keys and signed licenses can be exported to new files with --output. The CLI command set is init, issue, reissue, export and list.

Employee packaging requires server/office/issuer-public.pem containing the administrator's Ed25519 SPKI public key only. Private PEM material is rejected. The employee package does not contain the administrator utility, vault or private signing key. No production issuer identity has been provisioned by this milestone. Build preflight refuses packaging until an organization public verification root is supplied through the separate administrative process. Tests use disposable keys and never embed them into the employee build.

The desktop sets enforcement before backend startup. Packaged activation storage requires the existing OS-backed cipher (Electron safeStorage on Windows). Source/API acceptance tests use encrypted disposable key-file storage. Expiration denies new licensed mutations while preserving data reading, explicit Stop, recovery diagnostics and backup/cookie export. It does not terminate active browsers or delete data.

Encrypted activation state tracks a last-seen clock high-water mark. A backward jump over five minutes blocks licensed operations and asks for clock correction. A Windows reinstall or changed OS installation identity requires administrator reissue. This is not TPM attestation. An administrator who can modify the executable, registry and protected local state is outside the offline enforcement trust boundary. Fully offline clients cannot receive immediate remote revocations, and restoring an entire older system snapshot cannot be reliably detected without an independent trusted clock. Previously issued replacement licenses remain valid until expiration unless replaced on the original device.

## Cookie-Editor

The Extensions page offers an explicit official-store setup action for new and existing profiles. It opens the official Chrome Web Store or Mozilla Add-ons listing in the selected stopped profile and returns manualActionRequired=true, installed=false. The operator completes the browser's supported installation flow. It never bypasses store policy, disables signing or silently copies cookies or extension packages between employees.

Chrome listing ID: hlkenndednhfkekhgcdicdfddnkalmdm. Firefox add-on ID: {c3c10168-4186-445c-9c5b-63f12b8e2c87}. Source: https://github.com/Moustachauve/cookie-editor. Website: https://cookie-editor.com/. Firefox installation is governed by Mozilla signing. Post-stop inspection reports observed version/state and signing metadata. Chromium inspection reports browser-managed extension metadata and makes no independent CRX signature claim. Official-store installation and restart must be qualified on real browser versions before being marked verified.

The extension is GPL-3.0. This milestone links to official distributions and does not bundle its payload. If a later installer redistributes it, preserve authorship, copyright, GPL license and warranty notices, and provide the corresponding source through a compliant distribution method. Any modifications must carry the required notices. Review whether the chosen integration creates further GPL obligations before shipping a bundled derivative. GNU license text: https://www.gnu.org/licenses/gpl-3.0.html. Existing third-party acknowledgements remain intact.

## Cookies and backup

Existing encrypted profile/workspace backups continue preserving browser files and isolation. Optional cookie-only API transfers use the existing AES-256-GCM envelope and explicit sensitive-data confirmation. Imports require authenticated encryption, compatible engine, bounded/validated cookie records and explicit cross-profile transfer confirmation. Firefox cookie-only import remains unsupported. OS-bound Chromium values that cannot be decrypted are rejected rather than exported as empty strings. Full-profile backup is preferable for preserving supported browser state. Websites can expire or revoke sessions independently.

## Pending release qualification

No office installer or stable release is approved by these source changes. Real Windows 10 clean install, installed upgrade, official Cookie-Editor browser installation, restart/backup readback, organization trust-root provisioning and full office regression evidence are release gates. The administrator utility is currently a CLI rather than a separate graphical application. The protected Ultimate 3.0 branch and installer artifacts remain separate.
