'use client';

import * as React from 'react';
import DatePicker from 'react-datepicker';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarIcon } from 'lucide-react';

import 'react-datepicker/dist/react-datepicker.css';
import '@/styles/react-datepicker.css';

export type CalendarProps = {
  selected: Date | null;
  onChange: (date: Date | null) => void;
  placeholderText?: string;
  className?: string;
};

const CustomCalendar = ({ selected, onChange, placeholderText, className }: CalendarProps) => {
  const CustomInput = React.forwardRef<HTMLButtonElement, { value?: string; onClick?: () => void }>(({ value, onClick }, ref) => (
    <Button
      variant="outline"
      className={`w-full justify-start text-left font-normal ${!value && 'text-muted-foreground'}`}
      onClick={onClick}
      ref={ref}
    >
      <CalendarIcon className="mr-2 h-4 w-4" />
      {value ? format(new Date(value), 'PPP') : <span>{placeholderText || 'Pick a date'}</span>}
    </Button>
  ));
  CustomInput.displayName = 'CustomInput';

  return (
    <DatePicker
      selected={selected}
      onChange={onChange}
      customInput={<CustomInput />}
      showMonthDropdown
      showYearDropdown
      dropdownMode="select"
      popperPlacement="bottom-start"
      className={className}
    />
  );
};

CustomCalendar.displayName = 'Calendar';

export { CustomCalendar as Calendar };
