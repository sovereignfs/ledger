import { DeleteAccountSection } from './DeleteAccountSection';
import { ExportImportSection } from './ExportImportSection';

/**
 * Settings, Data (DESIGN.md §15.1): what leaves, what comes back, and what ends. The book is downloaded as one file and a file is imported into an empty book; deleting the
 * account is here too.
 */
export function DataSection() {
  return (
    <>
      <ExportImportSection />
      <DeleteAccountSection />
    </>
  );
}
