import { Request, Response } from "express";
import Doctor from "../models/Doctor";
import Patient from "../models/Patient";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import {
  INVERTED_RANGE_MESSAGE,
  resolveDateRange,
  startOfUtcDay,
} from "../utils/dateRange";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 90;

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const isoMonth = (d: Date): string => d.toISOString().slice(0, 7);

// Fill missing days/months with 0 between start and end (bucket keys only, not documents)
const fillDays = (buckets: Map<string, number>, start: Date, end: Date): { date: string; count: number }[] => {
  const out: { date: string; count: number }[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const key = isoDay(new Date(t));
    out.push({ date: key, count: buckets.get(key) || 0 });
  }
  return out;
};

const fillMonths = (buckets: Map<string, number>, start: Date, end: Date): { month: string; count: number }[] => {
  const out: { month: string; count: number }[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endKey = isoMonth(end);
  while (isoMonth(cur) <= endKey) {
    const key = isoMonth(cur);
    out.push({ month: key, count: buckets.get(key) || 0 });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
};

export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();

  // Optional range (validated as real dates by zod; capped at MAX_RANGE_DAYS)
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;
  if (req.query.from || req.query.to) {
    // Date-only `from` / `to` are resolved by the shared helper: `from` is the
    // start of that UTC day, `to` the end of that UTC day, so records created
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
    rangeStart = startOfUtcDay(rangeStart);
  }

  // Fixed windows (UTC-day aligned so bucket sums match the counts exactly)
  const last30Start = startOfUtcDay(new Date(now.getTime() - 29 * DAY_MS));
  const last7Start = startOfUtcDay(new Date(now.getTime() - 6 * DAY_MS));
  const sixMonthsStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

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
    Doctor.countDocuments(),
    Patient.countDocuments(),
    Patient.countDocuments({ createdAt: { $gte: last7Start } }),
    Patient.countDocuments({ createdAt: { $gte: last30Start } }),
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
    ]),
    Patient.aggregate([
      {
        $match: {
          createdAt: { $gte: patientsOverTimeStart, $lte: patientsOverTimeEnd },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
          count: { $sum: 1 },
        },
      },
    ]),
    Doctor.aggregate([
      { $match: { createdAt: { $gte: sixMonthsStart } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } },
          count: { $sum: 1 },
        },
      },
    ]),
    Patient.aggregate([
      ...(rangeStart
        ? [{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } }]
        : []),
      { $group: { _id: "$condition", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    Patient.aggregate([
      ...(rangeStart
        ? [{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } }]
        : []),
      { $lookup: { from: "doctors", localField: "doctor", foreignField: "_id", as: "doc" } },
      { $unwind: "$doc" },
      { $group: { _id: "$doc.specialization", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    Patient.aggregate([
      ...(rangeStart
        ? [{ $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } }]
        : []),
      { $group: { _id: "$gender", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    Patient.find()
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
  const doctorsOverTime = fillMonths(doctorsBuckets, sixMonthsStart, now);

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
