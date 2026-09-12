// Synthetic standards probes, not exports supplied by the reporting user.
const wrap = (...parts) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...parts, 'END:VCALENDAR'].join('\r\n');
const event = body => ['BEGIN:VEVENT', 'UID:probe', 'SUMMARY:Compatibility probe', body, 'END:VEVENT'].join('\r\n');
const europe = id => `BEGIN:VTIMEZONE
TZID:${id}
BEGIN:STANDARD
DTSTART:16011028T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010325T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE`;
const weekly = id => event(`DTSTART;TZID=${id}:20261018T100000\nDTEND;TZID=${id}:20261018T110000\nRRULE:FREQ=WEEKLY;COUNT=3`);
const expected = ['2026-10-18T08:00:00.000Z','2026-10-25T09:00:00.000Z','2026-11-01T09:00:00.000Z'];
module.exports = [
 {name:'utc',ics:wrap(event('DTSTART:20260914T100000Z\nDTEND:20260914T110000Z')),expected:['2026-09-14T10:00:00.000Z']},
 {name:'windows-1601-definition',ics:wrap(europe('W. Europe Standard Time'),weekly('W. Europe Standard Time')),expected},
 {name:'custom-definition',ics:wrap(europe('Custom/Office'),weekly('Custom/Office')),expected},
 {name:'iana-definition',ics:wrap(europe('Europe/Berlin'),weekly('Europe/Berlin')),expected},
 {name:'iana-without-definition',ics:wrap(weekly('Europe/Berlin')),expected},
 {name:'windows-without-definition',ics:wrap(weekly('W. Europe Standard Time')),expected},
 {name:'unknown-without-definition',ics:wrap(weekly('Unknown/Office')),expected:null},
 {name:'rdate-exdate',ics:wrap(event('DTSTART:20260914T100000Z\nDTEND:20260914T110000Z\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE:20260915T100000Z\nRDATE:20260918T100000Z')),expected:['2026-09-14T10:00:00.000Z','2026-09-16T10:00:00.000Z','2026-09-18T10:00:00.000Z']},
 {name:'moved-occurrence',ics:wrap(event('DTSTART:20260914T100000Z\nDTEND:20260914T110000Z\nRRULE:FREQ=DAILY;COUNT=3'),event('RECURRENCE-ID:20260915T100000Z\nDTSTART:20260915T130000Z\nDTEND:20260915T140000Z')),expected:['2026-09-14T10:00:00.000Z','2026-09-15T13:00:00.000Z','2026-09-16T10:00:00.000Z']},
 {name:'monthly-last-weekday',ics:wrap(event('DTSTART:20260930T100000Z\nDTEND:20260930T110000Z\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3')),expected:['2026-09-30T10:00:00.000Z','2026-10-30T10:00:00.000Z','2026-11-30T10:00:00.000Z']},
];
