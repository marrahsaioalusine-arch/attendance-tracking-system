-- =====================================================================
-- Reporting views
-- Attendance % = (Present + Late) / (Sessions recorded - Excused) * 100
-- =====================================================================
SET search_path TO cams;

CREATE OR REPLACE VIEW v_student_section_attendance AS
SELECT s.student_id, s.student_no, s.first_name || ' ' || s.last_name AS student_name,
       sec.section_id, c.course_code, c.course_title, sec.section_code, t.term_name,
       COUNT(ar.attendance_id)                              AS sessions_recorded,
       COUNT(*) FILTER (WHERE ar.status = 'Present')        AS present_count,
       COUNT(*) FILTER (WHERE ar.status = 'Late')           AS late_count,
       COUNT(*) FILTER (WHERE ar.status = 'Absent')         AS absent_count,
       COUNT(*) FILTER (WHERE ar.status = 'Excused')        AS excused_count,
       ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present','Late'))
             / NULLIF(COUNT(ar.attendance_id) - COUNT(*) FILTER (WHERE ar.status = 'Excused'), 0), 1) AS attendance_pct
FROM enrollments e
JOIN students s         ON s.student_id = e.student_id
JOIN class_sections sec ON sec.section_id = e.section_id
JOIN courses c          ON c.course_id = sec.course_id
JOIN academic_terms t   ON t.term_id = sec.term_id
LEFT JOIN class_sessions cs     ON cs.section_id = sec.section_id
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id AND ar.student_id = s.student_id
WHERE e.status = 'Active'
GROUP BY s.student_id, sec.section_id, c.course_id, t.term_id;

CREATE OR REPLACE VIEW v_session_summary AS
SELECT cs.session_id, cs.session_date, cs.start_time, cs.end_time, cs.topic,
       sec.section_id, c.course_code, sec.section_code,
       (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = sec.section_id AND e.status = 'Active') AS enrolled,
       COUNT(ar.attendance_id)                       AS recorded,
       COUNT(*) FILTER (WHERE ar.status = 'Present') AS present_count,
       COUNT(*) FILTER (WHERE ar.status = 'Late')    AS late_count,
       COUNT(*) FILTER (WHERE ar.status = 'Absent')  AS absent_count,
       COUNT(*) FILTER (WHERE ar.status = 'Excused') AS excused_count
FROM class_sessions cs
JOIN class_sections sec ON sec.section_id = cs.section_id
JOIN courses c          ON c.course_id = sec.course_id
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id
GROUP BY cs.session_id, sec.section_id, c.course_id;

CREATE OR REPLACE VIEW v_daily_attendance AS
SELECT cs.session_date,
       COUNT(DISTINCT cs.session_id)                 AS sessions,
       COUNT(ar.attendance_id)                       AS records,
       COUNT(*) FILTER (WHERE ar.status = 'Present') AS present_count,
       COUNT(*) FILTER (WHERE ar.status = 'Late')    AS late_count,
       COUNT(*) FILTER (WHERE ar.status = 'Absent')  AS absent_count,
       COUNT(*) FILTER (WHERE ar.status = 'Excused') AS excused_count
FROM class_sessions cs
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id
GROUP BY cs.session_date;

CREATE OR REPLACE VIEW v_course_statistics AS
SELECT c.course_id, c.course_code, c.course_title,
       COUNT(DISTINCT sec.section_id) AS sections,
       COUNT(DISTINCT cs.session_id)  AS sessions,
       COUNT(ar.attendance_id)        AS records,
       ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present','Late'))
             / NULLIF(COUNT(ar.attendance_id) - COUNT(*) FILTER (WHERE ar.status = 'Excused'), 0), 1) AS attendance_pct,
       COUNT(*) FILTER (WHERE ar.status = 'Absent') AS absences,
       COUNT(*) FILTER (WHERE ar.status = 'Late')   AS lates
FROM courses c
LEFT JOIN class_sections sec    ON sec.course_id = c.course_id
LEFT JOIN class_sessions cs     ON cs.section_id = sec.section_id
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id
GROUP BY c.course_id;

CREATE OR REPLACE VIEW v_low_attendance AS
SELECT v.*
FROM v_student_section_attendance v
WHERE v.attendance_pct IS NOT NULL
  AND v.attendance_pct < (SELECT setting_value::NUMERIC FROM system_settings WHERE setting_key = 'attendance_threshold');
