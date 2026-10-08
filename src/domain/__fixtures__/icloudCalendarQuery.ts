/**
 * Verbatim body of a calendar-query REPORT against an iCloud calendar
 * collection, captured with curl on 2026-08-17.
 *
 * Kept exactly as the server sent it. A hand-written fixture previously hid a
 * real bug: it used name="VEVENT" where Apple actually emits name='VEVENT',
 * so the collection-discovery tests passed against a document no server
 * produces. Anything asserted here is asserted against reality.
 *
 * Notable properties of this capture:
 *  - DAV: is the default namespace, so elements carry no prefix at all.
 *  - calendar-data is wrapped in CDATA.
 *  - The first event uses DTSTART;TZID=Pacific/Honolulu and ships a ~40-line
 *    VTIMEZONE after END:VEVENT.
 *  - The second item is one the plugin itself pushed: a VEVENT carrying the
 *    legacy "[TASK] " summary prefix.
 */
export const ICLOUD_CALENDAR_QUERY_RESPONSE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<multistatus xmlns="DAV:">
    
    
        <response>
            <href>/123456789/calendars/calendar-example-001/66666666-7777-4888-8999-AAAAAAAAAAAA.ics</href>
            <propstat>
                <prop>
                    
                        
                            <getetag xmlns="DAV:">"mswaqdsq"</getetag>
                        
                    
                        
                            <calendar-data xmlns="urn:ietf:params:xml:ns:caldav"><![CDATA[BEGIN:VCALENDAR
CALSCALE:GREGORIAN
PRODID:-//Apple Inc.//iPhone OS 26.6.1//EN
VERSION:2.0
BEGIN:VEVENT
CREATED:20260815T232656Z
DTEND;TZID=Pacific/Honolulu:20260818T112000
DTSTAMP:20260816T210741Z
DTSTART;TZID=Pacific/Honolulu:20260818T102000
LAST-MODIFIED:20260816T210739Z
SEQUENCE:0
SUMMARY:Dentist
UID:66666666-7777-4888-8999-AAAAAAAAAAAA
X-APPLE-CREATOR-IDENTITY:com.apple.mobilecal
X-APPLE-CREATOR-TEAM-IDENTITY:0000000000
TRANSP:OPAQUE
END:VEVENT
BEGIN:VTIMEZONE
TZID:Pacific/Honolulu
X-LIC-LOCATION:Pacific/Honolulu
BEGIN:STANDARD
DTSTART:18960113T120000
RDATE:18960113T120000
TZNAME:HST
TZOFFSETFROM:-103126
TZOFFSETTO:-1030
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19330430T020000
RDATE:19330430T020000
TZNAME:HDT
TZOFFSETFROM:-1030
TZOFFSETTO:-0930
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19330521T120000
RDATE:19330521T120000
RDATE:19450930T020000
TZNAME:HST
TZOFFSETFROM:-0930
TZOFFSETTO:-1030
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19420209T020000
RDATE:19420209T020000
TZNAME:HWT
TZOFFSETFROM:-1030
TZOFFSETTO:-0930
END:DAYLIGHT
BEGIN:DAYLIGHT
DTSTART:19450814T133000
RDATE:19450814T133000
TZNAME:HPT
TZOFFSETFROM:-0930
TZOFFSETTO:-0930
END:DAYLIGHT
BEGIN:STANDARD
DTSTART:19470608T020000
RDATE:19470608T020000
TZNAME:HST
TZOFFSETFROM:-1030
TZOFFSETTO:-1000
END:STANDARD
END:VTIMEZONE
END:VCALENDAR
]]></calendar-data>
                        
                    
                </prop>
                <status>HTTP/1.1 200 OK</status>
            </propstat>
            
        </response>
    
        <response>
            <href>/123456789/calendars/calendar-example-001/task-user-example-1.ics</href>
            <propstat>
                <prop>
                    
                        
                            <getetag xmlns="DAV:">"mswmonx8"</getetag>
                        
                    
                        
                            <calendar-data xmlns="urn:ietf:params:xml:ns:caldav"><![CDATA[BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Supernote Calendar Plugin//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:task-user-example-1
DTSTAMP:20260817T024212Z
SUMMARY:[TASK] Call the bank
DTSTART:20260819T190000Z
DTEND:20260819T193000Z
END:VEVENT
END:VCALENDAR
]]></calendar-data>
                        
                    
                </prop>
                <status>HTTP/1.1 200 OK</status>
            </propstat>
            
        </response>
    
</multistatus>`;
