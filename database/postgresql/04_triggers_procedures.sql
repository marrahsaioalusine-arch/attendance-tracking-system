-- =====================================================================
-- Triggers, functions and stored procedures (PL/pgSQL)
-- =====================================================================
SET search_path TO cams;

-- 1. Attendance may only be recorded for students actively enrolled in the session's section
CREATE OR REPLACE FUNCTION fn_attendance_requires_enrollment() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM enrollments e JOIN class_sessions cs ON cs.section_id = e.section_id
    WHERE cs.session_id = NEW.session_id AND e.student_id = NEW.student_id AND e.status = 'Active'
  ) THEN
    RAISE EXCEPTION 'Student % is not actively enrolled in the section for session %', NEW.student_id, NEW.session_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_requires_enrollment
BEFORE INSERT ON attendance_records
FOR EACH ROW EXECUTE FUNCTION fn_attendance_requires_enrollment();

-- 2. Block enrollment into a full section
CREATE OR REPLACE FUNCTION fn_enrollment_capacity() RETURNS TRIGGER AS $$
DECLARE v_count INT; v_cap INT;
BEGIN
  SELECT max_capacity INTO v_cap FROM class_sections WHERE section_id = NEW.section_id FOR UPDATE;
  SELECT COUNT(*) INTO v_count FROM enrollments WHERE section_id = NEW.section_id AND status = 'Active';
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'Class section % is at full capacity (%)', NEW.section_id, v_cap;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enrollment_capacity
BEFORE INSERT ON enrollments
FOR EACH ROW EXECUTE FUNCTION fn_enrollment_capacity();

-- 3. Audit every change of attendance status and stamp updated_at
CREATE OR REPLACE FUNCTION fn_attendance_audit() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO attendance_audit (attendance_id, old_status, new_status, changed_by)
    VALUES (OLD.attendance_id, OLD.status, NEW.status, NEW.recorded_by);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_audit
BEFORE UPDATE ON attendance_records
FOR EACH ROW EXECUTE FUNCTION fn_attendance_audit();

-- 4. Procedure: enroll a student (transactional, with clear errors)
CREATE OR REPLACE PROCEDURE sp_enroll_student(p_student_id INT, p_section_id INT)
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM enrollments WHERE student_id = p_student_id AND section_id = p_section_id) THEN
    RAISE EXCEPTION 'Student % is already enrolled in section %', p_student_id, p_section_id;
  END IF;
  INSERT INTO enrollments (student_id, section_id) VALUES (p_student_id, p_section_id);
END $$;

-- 5. Procedure: record (or update) one student's attendance, with authorization check
CREATE OR REPLACE PROCEDURE sp_record_attendance(
  p_session_id INT, p_student_id INT, p_status attendance_status,
  p_user_id INT, p_check_in TIME DEFAULT NULL, p_remarks VARCHAR DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE v_role user_role; v_ok BOOLEAN; v_date DATE;
BEGIN
  SELECT role INTO v_role FROM users WHERE user_id = p_user_id AND is_active;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Unknown or inactive user %', p_user_id; END IF;

  SELECT cs.session_date,
         (v_role = 'Administrator') OR EXISTS (
           SELECT 1 FROM class_sections sec JOIN instructors i ON i.instructor_id = sec.instructor_id
           WHERE sec.section_id = cs.section_id AND i.user_id = p_user_id)
    INTO v_date, v_ok
  FROM class_sessions cs WHERE cs.session_id = p_session_id;

  IF v_date IS NULL THEN RAISE EXCEPTION 'Session % does not exist', p_session_id; END IF;
  IF NOT v_ok THEN RAISE EXCEPTION 'User % is not authorized to record attendance for this session', p_user_id; END IF;
  IF v_date > CURRENT_DATE THEN RAISE EXCEPTION 'Cannot record attendance for a future session'; END IF;

  INSERT INTO attendance_records (session_id, student_id, status, check_in_time, remarks, recorded_by)
  VALUES (p_session_id, p_student_id, p_status, p_check_in, p_remarks, p_user_id)
  ON CONFLICT (session_id, student_id) DO UPDATE
    SET status = EXCLUDED.status, check_in_time = EXCLUDED.check_in_time,
        remarks = EXCLUDED.remarks, recorded_by = EXCLUDED.recorded_by;
END $$;

-- 6. Procedure: generate sessions for a section from its weekly schedule
CREATE OR REPLACE PROCEDURE sp_generate_sessions(p_section_id INT, p_from DATE, p_to DATE)
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO class_sessions (section_id, schedule_id, session_date, start_time, end_time)
  SELECT ss.section_id, ss.schedule_id, d::DATE, ss.start_time, ss.end_time
  FROM section_schedules ss
  CROSS JOIN generate_series(p_from, p_to, INTERVAL '1 day') AS d
  WHERE ss.section_id = p_section_id AND EXTRACT(ISODOW FROM d) = ss.day_of_week
  ON CONFLICT (section_id, session_date, start_time) DO NOTHING;
END $$;

-- 7. Function: attendance percentage for one student in one section
CREATE OR REPLACE FUNCTION fn_attendance_pct(p_student_id INT, p_section_id INT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT attendance_pct FROM v_student_section_attendance
  WHERE student_id = p_student_id AND section_id = p_section_id;
$$;
