"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
      <DayPicker
        showOutsideDays={showOutsideDays}
        className={cn("p-6", className)}
        classNames={{
          months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
          month: "space-y-4",
          caption: "flex justify-center pt-1 relative items-center mb-6",
          caption_label: "text-lg font-semibold text-gray-900",
          nav: "space-x-1 flex items-center",
          nav_button: cn(
            buttonVariants({ variant: "outline" }),
            "h-9 w-9 bg-white border-gray-300 p-0 opacity-70 hover:opacity-100 hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 rounded-lg shadow-sm"
          ),
          nav_button_previous: "absolute left-2",
          nav_button_next: "absolute right-2",
          table: "w-full border-collapse space-y-1",
          head_row: "flex mb-3",
          head_cell: "text-gray-600 rounded-lg w-11 h-11 font-semibold text-sm flex items-center justify-center uppercase tracking-wider",
          row: "flex w-full mt-2",
          cell: "h-11 w-11 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-lg [&:has([aria-selected].day-outside)]:bg-blue-50 [&:has([aria-selected])]:bg-blue-50 first:[&:has([aria-selected])]:rounded-l-lg last:[&:has([aria-selected])]:rounded-r-lg focus-within:relative focus-within:z-20",
          day: cn(
            buttonVariants({ variant: "ghost" }),
            "h-11 w-11 p-0 font-medium aria-selected:opacity-100 hover:bg-gray-100 hover:text-gray-900 transition-all duration-200 rounded-lg"
          ),
          day_range_end: "day-range-end",
          day_selected: "bg-blue-600 text-white hover:bg-blue-700 hover:text-white focus:bg-blue-700 focus:text-white rounded-lg font-semibold shadow-md",
          day_today: "bg-blue-50 text-blue-700 font-bold border border-blue-200 rounded-lg",
          day_outside: "day-outside text-gray-400 opacity-60 aria-selected:bg-blue-50 aria-selected:text-blue-600 aria-selected:opacity-80",
          day_disabled: "text-gray-300 opacity-40 cursor-not-allowed",
          day_range_middle: "aria-selected:bg-blue-50 aria-selected:text-blue-700",
          day_hidden: "invisible",
          ...classNames,
        }}
        {...props}
      />
    </div>
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
