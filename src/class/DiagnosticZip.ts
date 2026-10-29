import AdmZip from 'adm-zip';
import type {DiagnosticBundle} from '@/class/DiagnosticBundle';

/**
 * A diagnostic as a zip, for a cabinet that is not ONLINE: its owner sends it by mail. The same
 * layout as the zip MAUI-API's back office gives (maui-api D92), a MAME home that mhiex reads as
 * it is: hiscore/<rom>.hi, nvram/<rom>/<file>, logs/, sessions/, and diagnostic.json.
 */
export function diagnosticZip(bundle: DiagnosticBundle, now = new Date()): Buffer {
    const zip = new AdmZip();
    for (const file of bundle.files) {
        zip.addFile(file.area === 'nvram' ? `nvram/${bundle.romName}/${file.name}` : `${file.area}/${file.name}`, file.content);
    }
    zip.addFile('diagnostic.json', Buffer.from(JSON.stringify({
        romname: bundle.romName,
        comment: bundle.comment,
        created_at: now.toISOString(),
        report: bundle.report,
        files: bundle.files.map(file => ({area: file.area, name: file.name, size: file.content.length, modified: file.modified?.toISOString() ?? null})),
    }, null, 2)));
    return zip.toBuffer();
}
