-- =====================================================================
-- Example queries: CRUD, joins, reports and transactions
-- =====================================================================
SET search_path TO cams;

-- ---------- CRUD ----------
-- Create
INSERT INTO students (student_no, first_name, last_name, email, program_id, year_level, admitted_on)
VALUES ('S2026099', 'Test', 'Student', 'test.student@student.riverside.edu', 1, 1, CURRENT_DATE);
-- Read
SELECT student_no, first_name, last_name, email FROM students WHERE last_name ILIKE 'se%';
-- Update
UPDATE students SET phone = '+852 5555 0000' WHERE student_no = 'S2026099';
-- Delete
DELETE FROM students WHERE student_no = 'S2026099';

-- ---------- Joins ----------
-- Class roster with instructor and room
SELECT c.course_code || '-' || sec.section_code AS section, s.student_no,
       s.first_name || ' ' || s.last_name AS student, i.last_name AS instructor,
       r.building || ' ' || r.room_number AS room
FROM enrollments e
JOIN students s         ON s.student_id = e.student_id
JOIN class_sections sec ON sec.section_id = e.section_id
JOIN courses c          ON c.course_id = sec.course_id
LEFT JOIN instructors i ON i.instructor_id = sec.instructor_id
LEFT JOIN classrooms r  ON r.room_id = sec.room_id
WHERE e.status = 'Active'
ORDER BY section, s.last_name;

-- ---------- Reports ----------
-- 1. Individual student attendance history
SELECT cs.session_date, c.course_code, ar.status, ar.check_in_time, ar.remarks
FROM attendance_records ar
JOIN class_sessions cs  ON cs.session_id = ar.session_id
JOIN class_sections sec ON sec.section_id = cs.section_id
JOIN courses c          ON c.course_id = sec.course_id
JOIN students s         ON s.student_id = ar.student_id
WHERE s.student_no = 'S2026001'
ORDER BY cs.session_date DESC;

-- 2. Class attendance summary
SELECT * FROM v_student_section_attendance WHERE section_id = 1 ORDER BY attendance_pct;

-- 3. Daily attendance report
SELECT * FROM v_session_summary WHERE session_date = DATE '2026-09-07' ORDER BY start_time;

-- 4. Course attendance statistics
SELECT * FROM v_course_statistics ORDER BY attendance_pct DESC NULLS LAST;

-- 5. Student attendance percentage
SELECT fn_attendance_pct(1, 1) AS aminata_cs301_pct;

-- 6. Absence and lateness report
SELECT s.student_no, s.first_name || ' ' || s.last_name AS student,
       COUNT(*) FILTER (WHERE ar.status = 'Absent') AS absences,
       COUNT(*) FILTER (WHERE ar.status = 'Late')   AS lates
FROM attendance_records ar JOIN students s ON s.student_id = ar.student_id
GROUP BY s.student_id
HAVING COUNT(*) FILTER (WHERE ar.status IN ('Absent','Late')) > 0
ORDER BY absences DESC, lates DESC;

-- 7. Students below the attendance threshold
SELECT student_no, student_name, course_code, attendance_pct FROM v_low_attendance ORDER BY attendance_pct;

-- ---------- Transactions ----------
-- Record a whole session atomically: either every row is saved or none is.
BEGIN;
  CALL sp_record_attendance(3, 1, 'Late',    2, '13:10', 'Traffic');   -- fails: user 2 does not teach section 2
ROLLBACK;

BEGIN;
  CALL sp_record_attendance(3, 1, 'Late',    3, '13:10', 'Traffic');
  CALL sp_record_attendance(3, 3, 'Present', 3, '12:58');
COMMIT;

-- Duplicate enrollment is rejected by the UNIQUE constraint / procedure
BEGIN;
  CALL sp_enroll_student(1, 1);   -- ERROR: already enrolled
ROLLBACK;

-- Status changes are audited by trg_attendance_audit
UPDATE attendance_records SET status = 'Excused', remarks = 'Doctor note' WHERE session_id = 1 AND student_id = 4;
SELECT * FROM attendance_audit ORDER BY changed_at DESC;

-- Generate the rest of the term's sessions from the schedule
CALL sp_generate_sessions(1, DATE '2026-09-14', DATE '2026-09-30');
SELECT section_id, session_date, start_time FROM class_sessions WHERE section_id = 1 ORDER BY session_date;

-- ---------------------------------------------------------------------------
-- Attendance register: one row per student, one cell per session (section 1)
-- ---------------------------------------------------------------------------
SELECT s.student_no,
       s.first_name || ' ' || s.last_name AS student_name,
       string_agg(COALESCE(LEFT(ar.status::text, 1), '·'), ' ' ORDER BY cs.session_date, cs.start_time) AS register,
       COUNT(*) FILTER (WHERE ar.status = 'Present') AS present,
       COUNT(*) FILTER (WHERE ar.status = 'Late')    AS late,
       COUNT(*) FILTER (WHERE ar.status = 'Absent')  AS absent,
       COUNT(*) FILTER (WHERE ar.status = 'Excused') AS excused
FROM enrollments e
JOIN students s        ON s.student_id  = e.student_id
JOIN class_sessions cs ON cs.section_id = e.section_id
LEFT JOIN attendance_records ar
       ON ar.session_id = cs.session_id AND ar.student_id = s.student_id
WHERE e.section_id = 1 AND e.status = 'Active' AND cs.session_date <= CURRENT_DATE
GROUP BY s.student_id
ORDER BY s.last_name, s.first_name;

-- ---------------------------------------------------------------------------
-- Absences left: how many more classes each student can miss this term
-- and still finish at or above the threshold (assumes all other classes attended)
-- ---------------------------------------------------------------------------
WITH remaining AS (
  SELECT sec.section_id, COUNT(*) AS remaining_meetings
  FROM class_sections sec
  JOIN academic_terms t     ON t.term_id = sec.term_id AND t.is_current
  JOIN section_schedules ss ON ss.section_id = sec.section_id
  JOIN generate_series(CURRENT_DATE + 1, t.end_date, INTERVAL '1 day') AS d(day)
       ON EXTRACT(ISODOW FROM d.day) = ss.day_of_week
  GROUP BY sec.section_id
), thr AS (
  SELECT setting_value::numeric / 100 AS t FROM system_settings WHERE setting_key = 'attendance_threshold'
)
SELECT v.student_name, v.course_code || '-' || v.section_code AS section, v.attendance_pct,
       r.remaining_meetings,
       FLOOR((v.present_count + v.late_count) + r.remaining_meetings
             - thr.t * ((v.sessions_recorded - v.excused_count) + r.remaining_meetings)) AS absences_left
FROM v_student_section_attendance v
JOIN remaining r ON r.section_id = v.section_id
CROSS JOIN thr
ORDER BY absences_left, v.student_name;

-- ---------------------------------------------------------------------------
-- Audit trail with context (who changed which student's attendance, and when)
-- ---------------------------------------------------------------------------
SELECT a.changed_at, u.username AS changed_by,
       s.first_name || ' ' || s.last_name AS student_name,
       c.course_code || '-' || sec.section_code AS section, cs.session_date,
       a.old_status, a.new_status
FROM attendance_audit a
JOIN attendance_records ar ON ar.attendance_id = a.attendance_id
JOIN students s            ON s.student_id     = ar.student_id
JOIN class_sessions cs     ON cs.session_id    = ar.session_id
JOIN class_sections sec    ON sec.section_id   = cs.section_id
JOIN courses c             ON c.course_id      = sec.course_id
LEFT JOIN users u          ON u.user_id        = a.changed_by
ORDER BY a.changed_at DESC;
