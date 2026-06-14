import React, { useEffect, useState } from 'react';
import { getHolidayNamesForDate } from '../../lib/israeliJewishHolidays';

interface HolidayDateNoteProps {
  date: string;
}

const HolidayDateNote: React.FC<HolidayDateNoteProps> = ({ date }) => {
  const [holidays, setHolidays] = useState<string[]>([]);

  useEffect(() => {
    if (!date) {
      setHolidays([]);
      return;
    }
    let cancelled = false;
    void getHolidayNamesForDate(date).then((names) => {
      if (!cancelled) setHolidays(names);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (holidays.length === 0) return null;

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
      <p className="font-medium">Jewish / Israeli holiday</p>
      <p>{holidays.join(', ')}</p>
    </div>
  );
};

export default HolidayDateNote;
