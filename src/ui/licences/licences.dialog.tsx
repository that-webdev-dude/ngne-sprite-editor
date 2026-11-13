import type { LicencesRequest } from "../../app/licences/openLicences";
import { commandDialog } from "../dialogs/registry";
import { LicencesDialog } from "./LicencesDialog";

/** The dialog of Open Source Licences, shown by the dialog host. */
export const commandDialogs = [
    commandDialog<LicencesRequest>("licences", "Open Source Licences", LicencesDialog),
];
