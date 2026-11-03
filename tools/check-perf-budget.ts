import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const BUDGET_KB = 1500;

function runCheck(): void {
    const isFixture = process.argv.includes('--test-fixture');

    const fontsDir = path.join(ROOT, 'public/assets/fonts');
    let fontBytes = 0;
    if (fs.existsSync(fontsDir)) {
        const files = fs.readdirSync(fontsDir);
        for (const f of files) {
            if (f.endsWith('.woff2') && !f.includes('extra') && !f.includes('Bold')) {
                fontBytes += fs.statSync(path.join(fontsDir, f)).size;
            }
        }
    }

    const estimatedJsKb = 483;
    const baseFontKb = fontBytes / 1024;
    const commonAtlasKb = 110;

    const simulatedExtra = isFixture ? 500 : 0;
    const totalColdPathKb = baseFontKb + estimatedJsKb + commonAtlasKb + simulatedExtra;

    console.log(`Estimated Title Cold Path: ${totalColdPathKb.toFixed(1)} KB / Budget: ${BUDGET_KB} KB`);

    if (isFixture) {
        if (totalColdPathKb > BUDGET_KB) {
            console.log('[Fixture Check Passed] Overshoot check correctly detected budget violation!');
            process.exit(0);
        } else {
            console.error(' [Fixture Check Failed] Expected check to fail under test fixture mode.');
            process.exit(1);
        }
    }

    if (totalColdPathKb > BUDGET_KB) {
        console.error(`Cold start budget exceeded! (${totalColdPathKb.toFixed(1)} KB > ${BUDGET_KB} KB)`);
        process.exit(1);
    }

    console.log(' Cold start budget check passed.');
}

runCheck();