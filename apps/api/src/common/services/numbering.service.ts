import { Injectable } from "@nestjs/common";
import { formatSequenceNumber, sequencePeriod } from "@sqms/shared";
import type { Tx } from "../db/db.service";

/** Allocates human-readable identifiers atomically within the caller's transaction (row-locked sequence). */
@Injectable()
export class NumberingService {
  async next(tx: Tx, key: string, now = new Date()): Promise<string> {
    await tx.$queryRaw`SELECT id FROM numbering_sequences WHERE \`key\` = ${key} FOR UPDATE`;
    const seq = await tx.numberingSequence.findUnique({ where: { key } });
    if (!seq) throw new Error(`Numbering sequence ${key} is not configured`);
    const period = sequencePeriod(seq.resetPolicy, now);
    const value = period && seq.currentPeriod !== period ? 1 : seq.nextValue;
    await tx.numberingSequence.update({ where: { id: seq.id }, data: { nextValue: value + 1, currentPeriod: period } });
    return formatSequenceNumber(seq.pattern, seq.prefix, value, seq.padding, now);
  }
}
