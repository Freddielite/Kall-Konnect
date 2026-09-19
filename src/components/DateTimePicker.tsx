import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface DateTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  /** Latest selectable moment. Defaults to now - you can't log a call that hasn't happened yet. */
  maxDate?: Date;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
const MINUTES_5 = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,...,55

/**
 * Custom date + time picker (calendar day grid + hour/minute/AM-PM selects)
 * built from the app's own Calendar/Select primitives - deliberately not a
 * native <input type="datetime-local">, which renders as the OS's own
 * picker UI rather than something styled to match the app.
 */
export function DateTimePicker({ value, onChange, maxDate }: DateTimePickerProps) {
  const max = maxDate ?? new Date();

  const hour24 = value.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period: 'AM' | 'PM' = hour24 < 12 ? 'AM' : 'PM';
  // Snaps the current minute to the nearest option on the 5-minute select.
  const minuteOption = Math.round(value.getMinutes() / 5) * 5 % 60;

  // Never lets the composed date/time land after `max`.
  const clamp = (d: Date) => (d > max ? new Date(max) : d);

  const applyDay = (day: Date) => {
    const next = new Date(day);
    next.setHours(hour24, value.getMinutes(), 0, 0);
    onChange(clamp(next));
  };

  const applyHour12 = (h12: number) => {
    const next = new Date(value);
    next.setHours((h12 % 12) + (period === 'PM' ? 12 : 0));
    onChange(clamp(next));
  };

  const applyMinute = (m: number) => {
    const next = new Date(value);
    next.setMinutes(m, 0, 0);
    onChange(clamp(next));
  };

  const applyPeriod = (p: 'AM' | 'PM') => {
    const next = new Date(value);
    next.setHours((hour12 % 12) + (p === 'PM' ? 12 : 0));
    onChange(clamp(next));
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && applyDay(d)}
          disabled={(date) => date > max}
          className="rounded-md border"
        />
      </div>
      <div className="flex items-center justify-center gap-2">
        <Select value={String(hour12)} onValueChange={(v) => applyHour12(Number(v))}>
          <SelectTrigger className="w-[72px]" aria-label="Hour">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOURS_12.map((h) => (
              <SelectItem key={h} value={String(h)}>{h}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">:</span>
        <Select value={String(minuteOption)} onValueChange={(v) => applyMinute(Number(v))}>
          <SelectTrigger className="w-[72px]" aria-label="Minute">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MINUTES_5.map((m) => (
              <SelectItem key={m} value={String(m)}>{String(m).padStart(2, '0')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(v) => applyPeriod(v as 'AM' | 'PM')}>
          <SelectTrigger className="w-[72px]" aria-label="AM/PM">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
