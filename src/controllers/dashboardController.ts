import { Request, Response } from "express";
import Doctor from "../models/Doctor";
import Patient from "../models/Patient";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import {
  APP_TIMEZONE,
  DAY_MS,
  INVERTED_RANGE_MESSAGE,
  dhakaDayKey,
  dhakaMonthKey,
  lastNDhakaMonthKeys,
  resolveDateRange,
  startOfDhakaDay,
  startOfDhakaMonth,
} from "../utils/dateRange";

const MAX_RANGE_DAYS = 90;

/** Number of months shown in the "doctors over time" chart. */
const DOCTORS_OVER_TIME_MONTHS = 6;

/**
 * Fills the missing days with 0 (bucket keys only, not documents).
 *
 * The series is walked by Asia/Dhaka day keys, so it contains exactly one
 * entry per Dhaka day between `start` and `end` (both inclusive) without gaps
 * and without duplicates.
 */
const fillDays = (buckets: Map<string, number>, start: Date, end: Date): { date: string; count: number }[] => {
  const out: { date: string; count: number }[] = [];
  const endKey = dhakaDayKey(end);

  // A Dhaka day is exactly 24h (no DST), so stepping one day keeps the
  // buckets aligned with the Dhaka day boundaries.
  let cursor = startOfDhakaDay(start);
  while (dhakaDayKey(cursor) <= endKey) {
    const key = dhakaDayKey(cursor);
    out.push({ date: key, count: buckets.get(key) ?? 0 });
    cursor = new Date(cursor.getTime() + DAY_MS);
  }

  return out;
};

/**
 * Fills the missing months with 0 (bucket keys only, not documents).
 *
 * `monthKeys` are the Asia/Dhaka month keys of the series and
 * `currentMonthKey` is the month of "now" in Asia/Dhaka: the series always
 * ends with it and holds exactly one entry per month.
 */
const fillMonths = (
  buckets: Map<string, number>,
  monthKeys: string[],
  currentMonthKey: string
): { month: string; count: number }[] => {
  const keys = monthKeys.slice(0, -1).concat(currentMonthKey);
  return keys.map((month) => ({ month, count: buckets.get(month) ?? 0 }));
};

export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();

  // Optional range (validated as real dates by zod; capped at MAX_RANGE_DAYS)
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;
  if (req.query.from || req.query.to) {
    // Date-only `from` / `to` are resolved by the shared helper: `from` is the
    // start of that Asia/Dhaka day, `to` the end of that Asia/Dhaka day, so records created
    // later that day are still part of the range.
    const range = resolveDateRange(
      req.query.from as string | undefined,
      req.query.to as string | undefined
    );
    rangeEnd = range.to ?? now;
    rangeStart = range.from ?? new Date(rangeEnd.getTime() - 29 * DAY_MS);
    if (rangeStart.getTime() > rangeEnd.getTime()) {
      throw new AppError(INVERTED_RANGE_MESSAGE, 400);
    }
    const minStart = new Date(rangeEnd.getTime() - (MAX_RANGE_DAYS - 1) * DAY_MS);
    if (rangeStart < minStart) rangeStart = minStart;
    rangeStart = startOfDhakaDay(rangeStart);
  }

  // Fixed windows (Asia/Dhaka-day aligned so bucket sums match the counts exactly)
  const last30Start = startOfDhakaDay(new Date(now.getTime() - 29 * DAY_MS));
  const last7Start = startOfDhakaDay(new Date(now.getTime() - 6 * DAY_MS));

  // Doctors over time: exactly 6 Asia/Dhaka months, the last one being the
  // current month (e.g. 2026-05 ... 2026-10). The window starts at 00:00
  // Dhaka time on the 1st of the oldest month of the series.
  const doctorsMonthKeys = lastNDhakaMonthKeys(now, DOCTORS_OVER_TIME_MONTHS);
  const currentMonthKey = dhakaMonthKey(now);
  const sixMonthsStart = startOfDhakaMonth(doctorsMonthKeys[0]);

  const patientsOverTimeStart = rangeStart || last30Start;
  const patientsOverTimeEnd = rangeEnd || now;

  const [
    totalsDoctors,
    totalsPatients,
    patientsAddedLast7Days,
    patientsAddedLast30Days,
    patientsPerDoctor,
    patientsOverTimeAgg,
    doctorsOverTimeAgg,
    conditionAgg,
    specializationAgg,
    genderAgg,
    recentPatientsRaw,
  ] = await Promise.all([
    Doctor.countDocuments().hint({ _id: 1 }),
    Patient.countDocuments().hint({ _id: 1 }),
    Patient.countDocuments({ createdAt: { $gte: last7Start } }).hint({ createdAt: -1 }),
    Patient.countDocuments({ createdAt: { $gte: last30Start } }).hint({ createdAt: -1 }),
    Patient.aggregate([
      { $group: { _id: "$doctor", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "doctors",
          localField: "_id",
          foreignField: "_id",
          as: "doc",
        },
      },
      { $unwind: "$doc" },
      {
        $project: {
          _id: 0,
          doctorId: "$_id",
          name: "$doc.name",
          specialization: "$doc.specialization",
          count: 1,
        },
      },
    ]).hint({ doctor: 1, createdAt: -1 }),
    Patient.aggregate([
      {
        $match: {
          createdAt: { $gte: patientsOverTimeStart, $lte: patientsOverTimeEnd },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: APP_TIMEZONE } },
          count: { $sum: 1 },
        },
      },
    ]).hint({ createdAt: -1 }),
    Doctor.aggregate([
      { $match: { createdAt: { $gte: sixMonthsStart } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: APP_TIMEZONE } },
          count: { $sum: 1 },
        },
      },
    ]).hint({ createdAt: -1 }),
    Patient.aggregate([
      ...(rangeStart
        ? [{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } }]
        : []),
      { $group: { _id: "$condition", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]).hint(rangeStart ? { createdAt: -1 } : { condition: 1, createdAt: -1 }),
    Patient.aggregate([
      ...(rangeStart
        ? [{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } }]
        : []),
      { $group: { _id: "$doctor", count: { $sum: 1 } } },
      { $lookup: { from: "doctors", localField: "_id", foreignField: "_id", as: "doc" } },
      { $unwind: "$doc" },
      { $group: { _id: "$doc.specialization", count: { $sum: "$count" } } },
      { $sort: { count: -1, _id: 1 } },
    ]).hint(rangeStart ? { createdAt: -1 } : { doctor: 1, createdAt: -1 }),
    Patient.aggregate([
      ...(rangeStart
        ? [{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } }]
        : []),
      { $group: { _id: "$gender", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]).hint(rangeStart ? { createdAt: -1 } : { gender: 1, createdAt: -1 }),
    Patient.find()
      .select("_id name condition doctor createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("doctor", "name")
      .lean(),
  ]);

  // Time series with buckets filled with 0
  const overTimeBuckets = new Map<string, number>();
  patientsOverTimeAgg.forEach((b: any) => overTimeBuckets.set(b._id, b.count));
  const patientsOverTime = fillDays(overTimeBuckets, patientsOverTimeStart, patientsOverTimeEnd);

  const doctorsBuckets = new Map<string, number>();
  doctorsOverTimeAgg.forEach((b: any) => doctorsBuckets.set(b._id, b.count));
  const doctorsOverTime = fillMonths(doctorsBuckets, doctorsMonthKeys, currentMonthKey);

  // Top 6 conditions + "Other" bucket
  const topConditions = conditionAgg.slice(0, 6).map((c: any) => ({
    condition: c._id,
    count: c.count,
  }));
  const otherCount = conditionAgg.slice(6).reduce((sum: number, c: any) => sum + c.count, 0);
  if (otherCount > 0) {
    topConditions.push({ condition: "Other", count: otherCount });
  }

  const specializationDistribution = specializationAgg.map((s: any) => ({
    specialization: s._id,
    count: s.count,
  }));

  const genderDistribution = genderAgg.map((g: any) => ({
    gender: g._id,
    count: g.count,
  }));

  const recentPatients = recentPatientsRaw.map((p: any) => ({
    patientId: p._id,
    name: p.name,
    condition: p.condition,
    doctorName: p.doctor?.name || null,
    createdAt: p.createdAt,
  }));

  res.status(200).json({
    success: true,
    data: {
      totals: { doctors: totalsDoctors, patients: totalsPatients },
      patientsAddedLast7Days,
      patientsAddedLast30Days,
      patientsPerDoctor,
      patientsOverTime,
      doctorsOverTime,
      conditionDistribution: topConditions,
      specializationDistribution,
      genderDistribution,
      recentPatients,
    },
    message: "Dashboard stats retrieved successfully",
  });
});
