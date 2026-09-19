import { ChevronUp, ChevronDown } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  /** Latest selectable moment. Defaults to now - you can't log a call that hasn't happened yet. */
  maxDate?: Date;
}

/**
 * Custom date + time picker: a calendar day grid plus hour/minute steppers
 * and an AM/PM toggle, all plain buttons - deliberately not a native
 * <input type="datetime-local"> (the OS's own picker UI) and not a Radix
 * Select either, which rendered blank and didn't respond to taps once
 * nested inside this app's animated Dialog.
 */
export function DateTimePicker({ value, onChange, maxDate }: DateTimePickerProps) {
  const max = maxDate ?? new Date();

  const hour24 = value.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period: 'AM' | 'PM' = hour24 < 12 ? 'AM' : 'PM';
  // Snaps the current minute to the nearest 5-minute step.
  const minuteStep = Math.round(value.getMinutes() / 5) * 5 % 60;

  // Never lets the composed date/time land after `max`.
  const clamp = (d: Date) => (d > max ? new Date(max) : d);

  const applyDay = (day: Date) => {
    const next = new Date(day);
    next.setHours(hour24, value.getMinutes(), 0, 0);
    onChange(clamp(next));
  };

  const candidateHour = (delta: 1 | -1) => {
    const next = new Date(value);
    // 12-hour wheel: 12 -> 1 -> ... -> 11 -> 12, independent of AM/PM.
    const nextHour12 = ((hour12 - 1 + delta + 12) % 12) + 1;
    next.setHours((nextHour12 % 12) + (period === 'PM' ? 12 : 0));
    return next;
  };

  const candidateMinute = (delta: 1 | -1) => {
    const next = new Date(value);
    next.setMinutes(((minuteStep + delta * 5 + 60) % 60), 0, 0);
    return next;
  };

  // Rather than clamping a disallowed step back down to `max` (which, right
  // at the current moment, looks like the button did nothing at all), the
  // up-steppers disable themselves once stepping would land in the future -
  // see hourUpDisabled/minuteUpDisabled below, used on the buttons.
  const hourUpDisabled = candidateHour(1) > max;
  const minuteUpDisabled = candidateMinute(1) > max;

  const shiftHour = (delta: 1 | -1) => {
    const next = candidateHour(delta);
    if (next > max) return;
    onChange(next);
  };

  const shiftMinute = (delta: 1 | -1) => {
    const next = candidateMinute(delta);
    if (next > max) return;
    onChange(next);
  };

  const applyPeriod = (p: 'AM' | 'PM') => {
    const next = new Date(value);
    next.setHours((hour12 % 12) + (p === 'PM' ? 12 : 0));
    onChange(clamp(next));
  };

  const stepperColumnClass = 'flex flex-col items-center gap-1';
  const stepperButtonClass = 'h-7 w-9 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors';

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => d && applyDay(d)}
          disabled={(date) => date > max}
          className="rounded-md border"
        />
      </div>
      <div className="flex items-center justify-center gap-3">
        <div className={stepperColumnClass}>
          <button
            type="button"
            aria-label="Next hour"
            className={cn(stepperButtonClass, 'disabled:opacity-30 disabled:pointer-events-none')}
            onClick={() => shiftHour(1)}
            disabled={hourUpDisabled}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <div className="text-2xl font-semibold tabular-nums w-10 text-center">{hour12}</div>
          <button type="button" aria-label="Previous hour" className={stepperButtonClass} onClick={() => shiftHour(-1)}>
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <span className="text-2xl font-semibold text-muted-foreground pb-6">:</span>
        <div className={stepperColumnClass}>
          <button
            type="button"
            aria-label="Next minute"
            className={cn(stepperButtonClass, 'disabled:opacity-30 disabled:pointer-events-none')}
            onClick={() => shiftMinute(1)}
            disabled={minuteUpDisabled}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <div className="text-2xl font-semibold tabular-nums w-10 text-center">{String(minuteStep).padStart(2, '0')}</div>
          <button type="button" aria-label="Previous minute" className={stepperButtonClass} onClick={() => shiftMinute(-1)}>
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-1 pl-2">
          <Button
            type="button"
            size="sm"
            variant={period === 'AM' ? 'default' : 'outline'}
            className={cn('h-7 px-3 rounded-md')}
            onClick={() => applyPeriod('AM')}
          >
            AM
          </Button>
          <Button
            type="button"
            size="sm"
            variant={period === 'PM' ? 'default' : 'outline'}
            className={cn('h-7 px-3 rounded-md')}
            onClick={() => applyPeriod('PM')}
          >
            PM
          </Button>
        </div>
      </div>
    </div>
  );
}
