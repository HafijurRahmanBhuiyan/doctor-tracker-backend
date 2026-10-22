import Doctor from "../models/Doctor";
import Patient from "../models/Patient";
import { searchTokens } from "./searchTokens";

const BATCH_SIZE = 500;

async function backfillModel<T extends { _id: unknown; searchTokens?: string[] }>(
  model: any,
  fields: string[]
): Promise<number> {
  const cursor = model
    .find({ $or: [{ searchTokens: { $exists: false } }, { searchTokens: null }, { searchTokens: { $size: 0 } }] })
    .select(["_id", ...fields].join(" "))
    .lean()
    .cursor({ batchSize: BATCH_SIZE });
  let batch: T[] = [];
  let updated = 0;
  const writeBatch = async () => {
    if (!batch.length) return;
    const result = await model.collection.bulkWrite(
      batch.map((record) => ({
        updateOne: {
          filter: { _id: record._id },
          update: { $set: { searchTokens: searchTokens(...fields.map((field) => (record as any)[field])) } },
        },
      })),
      { ordered: false }
    );
    updated += result.modifiedCount;
    batch = [];
  };
  for await (const record of cursor) {
    batch.push(record as T);
    if (batch.length >= BATCH_SIZE) await writeBatch();
  }
  await writeBatch();
  return updated;
}

/** Idempotently fills indexed search tokens for legacy documents in bounded batches. */
export async function backfillSearchTokens(): Promise<{ doctors: number; patients: number }> {
  const doctors = await backfillModel(Doctor, ["name", "email", "phone", "specialization", "hospital"]);
  const patients = await backfillModel(Patient, ["name", "email", "phone", "condition"]);
  return { doctors, patients };
}
