import { describe, expect, it } from "vitest";
import { formatDue, parseTime } from "./DateTimePicker";

describe("parseTime", () => {
  it.each([
    ["14:30", 14, 30], ["9", 9, 0], ["930", 9, 30], ["0930", 9, 30], ["9.30", 9, 30],
    ["2pm", 14, 0], ["2 PM", 14, 0], ["11:15 am", 11, 15], ["12am", 0, 0], ["12pm", 12, 0], ["23:59", 23, 59], ["0:00", 0, 0],
  ])("%s", (input, h, m) => expect(parseTime(input)).toEqual({ h, m }));

  it.each(["", "abc", "24:00", "12:60", "13pm", "0am", "9:5", "1:2:3"])("rejects %j", (input) =>
    expect(parseTime(input)).toBeNull(),
  );
});

describe("formatDue", () => {
  const at = (days: number, h = 14, m = 5) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, h, m);
  };
  it("uses relative day names", () => {
    expect(formatDue({ date: at(0), allDay: false })).toBe("Today, 14:05");
    expect(formatDue({ date: at(1), allDay: false })).toBe("Tomorrow, 14:05");
    expect(formatDue({ date: at(-1), allDay: false })).toBe("Yesterday, 14:05");
  });
  it("omits the time for all-day", () => {
    expect(formatDue({ date: at(1, 0, 0), allDay: true })).toBe("Tomorrow");
  });
  it("is empty without a date", () => expect(formatDue({ date: null, allDay: false })).toBe(""));
});
