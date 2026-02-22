const DAY_MS = 24 * 60 * 60 * 1000
const MADRID_TIME_ZONE = 'Europe/Madrid'

export function startOfTodayISO(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString()
}

export function endOfTodayISO(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString()
}

function getMadridDateParts(date: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)

  return { year, month, day }
}

function getOffsetMinutes(timeZone: string, utcDate: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
  const tzName = formatter
    .formatToParts(utcDate)
    .find((part) => part.type === 'timeZoneName')
    ?.value.replace('GMT', '')

  if (!tzName || tzName === '' || tzName === '0') {
    return 0
  }

  const sign = tzName.startsWith('-') ? -1 : 1
  const normalized = tzName.replace(/^[-+]/, '')
  const [hoursPart, minutesPart = '0'] = normalized.split(':')

  return sign * (Number(hoursPart) * 60 + Number(minutesPart))
}

function madridDateAtNineIso(year: number, month: number, day: number): string {
  const middayUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const offsetMinutes = getOffsetMinutes(MADRID_TIME_ZONE, middayUtc)
  const utcMillisForMadridNine = Date.UTC(year, month - 1, day, 9, 0, 0) - offsetMinutes * 60_000

  return new Date(utcMillisForMadridNine).toISOString()
}

export function isoAtMadridNineAMInDays(daysFromNow: number): string {
  const madridToday = getMadridDateParts(new Date())
  const targetDayUtc = new Date(Date.UTC(madridToday.year, madridToday.month - 1, madridToday.day) + daysFromNow * DAY_MS)

  return madridDateAtNineIso(
    targetDayUtc.getUTCFullYear(),
    targetDayUtc.getUTCMonth() + 1,
    targetDayUtc.getUTCDate(),
  )
}

export function isoAtMadridNineAMForDateInput(dateInput: string): string {
  const [yearText, monthText, dayText] = dateInput.split('-')
  return madridDateAtNineIso(Number(yearText), Number(monthText), Number(dayText))
}
