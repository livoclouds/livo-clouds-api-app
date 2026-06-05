import { PartialType } from '@nestjs/swagger';
import { CreateDossierEntryDto } from './create-dossier-entry.dto';

// All fields optional — a dossier entry is patched (e.g. a status change or a
// note). The evidence rule (HIGH requires referenceFolio) is re-checked in the
// service against the merged result, not the DTO alone.
export class UpdateDossierEntryDto extends PartialType(CreateDossierEntryDto) {}
