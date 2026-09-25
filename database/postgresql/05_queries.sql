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
