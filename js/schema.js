// Class Attendance Management System — relational schema (SQLite dialect, runs in the browser via sql.js)
// The PostgreSQL version of the same design lives in /database/postgresql.
window.CAMS_SCHEMA = `
PRAGMA foreign_keys = ON;

-- ============ Reference data ============
CREATE TABLE departments (
  department_id   INTEGER PRIMARY KEY,
  department_code TEXT NOT NULL UNIQUE,
  department_name TEXT NOT NULL UNIQUE
);

CREATE TABLE programs (
  program_id    INTEGER PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(department_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  program_code  TEXT NOT NULL UNIQUE,
  program_name  TEXT NOT NULL
);

CREATE TABLE academic_terms (
  term_id    INTEGER PRIMARY KEY,
  term_name  TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  CHECK (end_date > start_date)
);

CREATE TABLE classrooms (
  room_id     INTEGER PRIMARY KEY,
  building    TEXT NOT NULL,
  room_number TEXT NOT NULL,
  capacity    INTEGER NOT NULL CHECK (capacity > 0),
  UNIQUE (building, room_number)
);

-- ============ Users and roles ============
CREATE TABLE users (
  user_id       INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('Administrator','Instructor','Student')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE students (
  student_id    INTEGER PRIMARY KEY,
  user_id       INTEGER UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
  student_no    TEXT NOT NULL UNIQUE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE CHECK (email LIKE '%_@_%._%'),
  phone         TEXT,
  program_id    INTEGER NOT NULL REFERENCES programs(program_id) ON DELETE RESTRICT,
  year_level    INTEGER NOT NULL CHECK (year_level BETWEEN 1 AND 6),
  admitted_on   TEXT NOT NULL
);

CREATE TABLE instructors (
  instructor_id INTEGER PRIMARY KEY,
  user_id       INTEGER UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
  staff_no      TEXT NOT NULL UNIQUE,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE CHECK (email LIKE '%_@_%._%'),
  phone         TEXT,
  department_id INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT
);

-- ============ Courses, sections, schedules ============
CREATE TABLE courses (
  course_id     INTEGER PRIMARY KEY,
  course_code   TEXT NOT NULL UNIQUE,
  course_title  TEXT NOT NULL,
  credits       INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 6),
  department_id INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT
);

CREATE TABLE class_sections (
  section_id    INTEGER PRIMARY KEY,
  course_id     INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  term_id       INTEGER NOT NULL REFERENCES academic_terms(term_id) ON DELETE RESTRICT,
  section_code  TEXT NOT NULL,
  instructor_id INTEGER REFERENCES instructors(instructor_id) ON DELETE SET NULL,
  room_id       INTEGER REFERENCES classrooms(room_id) ON DELETE SET NULL,
  max_capacity  INTEGER NOT NULL CHECK (max_capacity > 0),
  UNIQUE (course_id, term_id, section_code)
);

CREATE TABLE section_schedules (
  schedule_id INTEGER PRIMARY KEY,
  section_id  INTEGER NOT NULL REFERENCES class_sections(section_id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1 = Monday
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  CHECK (end_time > start_time),
  UNIQUE (section_id, day_of_week, start_time)
);

-- ============ Enrollment ============
CREATE TABLE enrollments (
  enrollment_id INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  section_id    INTEGER NOT NULL REFERENCES class_sections(section_id) ON DELETE CASCADE,
  enrolled_on   TEXT NOT NULL DEFAULT (date('now')),
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Dropped')),
  UNIQUE (student_id, section_id)            -- no duplicate enrollment
);

-- ============ Attendance ============
CREATE TABLE class_sessions (
  session_id   INTEGER PRIMARY KEY,
  section_id   INTEGER NOT NULL REFERENCES class_sections(section_id) ON DELETE CASCADE,
  schedule_id  INTEGER REFERENCES section_schedules(schedule_id) ON DELETE SET NULL,
  session_date TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  topic        TEXT,
  CHECK (end_time > start_time),
  UNIQUE (section_id, session_date, start_time)
);

CREATE TABLE attendance_records (
  attendance_id INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES class_sessions(session_id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('Present','Absent','Late','Excused')),
  check_in_time TEXT,
  remarks       TEXT,
  recorded_by   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT,
  UNIQUE (session_id, student_id)            -- no duplicate attendance per session
);

CREATE TABLE attendance_audit (
  audit_id      INTEGER PRIMARY KEY,
  attendance_id INTEGER NOT NULL,
  old_status    TEXT,
  new_status    TEXT,
  changed_by    INTEGER,
  changed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE system_settings (
  setting_key   TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL
);

-- ============ Indexes ============
CREATE INDEX idx_sections_instructor  ON class_sections(instructor_id);
CREATE INDEX idx_sections_term        ON class_sections(term_id);
CREATE INDEX idx_enroll_section       ON enrollments(section_id);
CREATE INDEX idx_sessions_section_dt  ON class_sessions(section_id, session_date);
CREATE INDEX idx_sessions_date        ON class_sessions(session_date);
CREATE INDEX idx_attendance_student   ON attendance_records(student_id);
CREATE INDEX idx_attendance_status    ON attendance_records(status);
CREATE INDEX idx_students_name        ON students(last_name, first_name);

-- ============ Triggers ============
-- Only students actively enrolled in the session's section can receive attendance.
CREATE TRIGGER trg_attendance_requires_enrollment
BEFORE INSERT ON attendance_records
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM enrollments e
  JOIN class_sessions cs ON cs.section_id = e.section_id
  WHERE cs.session_id = NEW.session_id AND e.student_id = NEW.student_id AND e.status = 'Active'
)
BEGIN
  SELECT RAISE(ABORT, 'Student is not actively enrolled in this class section');
END;

-- Block enrollment when the section is full.
CREATE TRIGGER trg_enrollment_capacity
BEFORE INSERT ON enrollments
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM enrollments WHERE section_id = NEW.section_id AND status = 'Active')
     >= (SELECT max_capacity FROM class_sections WHERE section_id = NEW.section_id)
BEGIN
  SELECT RAISE(ABORT, 'Class section is at full capacity');
END;

-- Keep an audit trail whenever an attendance status is changed.
CREATE TRIGGER trg_attendance_audit
AFTER UPDATE OF status ON attendance_records
FOR EACH ROW
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO attendance_audit (attendance_id, old_status, new_status, changed_by)
  VALUES (OLD.attendance_id, OLD.status, NEW.status, NEW.recorded_by);
END;

-- ============ Views (reports) ============
-- Attendance % = (Present + Late) / (Sessions recorded - Excused) * 100
CREATE VIEW v_student_section_attendance AS
SELECT s.student_id, s.student_no, s.first_name || ' ' || s.last_name AS student_name,
       sec.section_id, c.course_code, c.course_title, sec.section_code, t.term_name,
       COUNT(ar.attendance_id)                                   AS sessions_recorded,
       SUM(CASE WHEN ar.status = 'Present' THEN 1 ELSE 0 END)    AS present_count,
       SUM(CASE WHEN ar.status = 'Late'    THEN 1 ELSE 0 END)    AS late_count,
       SUM(CASE WHEN ar.status = 'Absent'  THEN 1 ELSE 0 END)    AS absent_count,
       SUM(CASE WHEN ar.status = 'Excused' THEN 1 ELSE 0 END)    AS excused_count,
       ROUND(100.0 * SUM(CASE WHEN ar.status IN ('Present','Late') THEN 1 ELSE 0 END)
             / NULLIF(COUNT(ar.attendance_id) - SUM(CASE WHEN ar.status = 'Excused' THEN 1 ELSE 0 END), 0), 1)
                                                                 AS attendance_pct
FROM enrollments e
JOIN students s         ON s.student_id = e.student_id
JOIN class_sections sec ON sec.section_id = e.section_id
JOIN courses c          ON c.course_id = sec.course_id
JOIN academic_terms t   ON t.term_id = sec.term_id
LEFT JOIN class_sessions cs     ON cs.section_id = sec.section_id
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id AND ar.student_id = s.student_id
WHERE e.status = 'Active'
GROUP BY s.student_id, sec.section_id;

CREATE VIEW v_session_summary AS
SELECT cs.session_id, cs.session_date, cs.start_time, cs.end_time, cs.topic,
       sec.section_id, c.course_code, sec.section_code,
       (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = sec.section_id AND e.status = 'Active') AS enrolled,
       COUNT(ar.attendance_id)                                AS recorded,
       SUM(CASE WHEN ar.status = 'Present' THEN 1 ELSE 0 END) AS present_count,
       SUM(CASE WHEN ar.status = 'Late'    THEN 1 ELSE 0 END) AS late_count,
       SUM(CASE WHEN ar.status = 'Absent'  THEN 1 ELSE 0 END) AS absent_count,
       SUM(CASE WHEN ar.status = 'Excused' THEN 1 ELSE 0 END) AS excused_count
FROM class_sessions cs
JOIN class_sections sec ON sec.section_id = cs.section_id
JOIN courses c          ON c.course_id = sec.course_id
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id
GROUP BY cs.session_id;

CREATE VIEW v_daily_attendance AS
SELECT cs.session_date,
       COUNT(DISTINCT cs.session_id)                          AS sessions,
       COUNT(ar.attendance_id)                                AS records,
       SUM(CASE WHEN ar.status = 'Present' THEN 1 ELSE 0 END) AS present_count,
       SUM(CASE WHEN ar.status = 'Late'    THEN 1 ELSE 0 END) AS late_count,
       SUM(CASE WHEN ar.status = 'Absent'  THEN 1 ELSE 0 END) AS absent_count,
       SUM(CASE WHEN ar.status = 'Excused' THEN 1 ELSE 0 END) AS excused_count
FROM class_sessions cs
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id
GROUP BY cs.session_date;

CREATE VIEW v_course_statistics AS
SELECT c.course_id, c.course_code, c.course_title,
       COUNT(DISTINCT sec.section_id) AS sections,
       COUNT(DISTINCT cs.session_id)  AS sessions,
       COUNT(ar.attendance_id)        AS records,
       ROUND(100.0 * SUM(CASE WHEN ar.status IN ('Present','Late') THEN 1 ELSE 0 END)
             / NULLIF(COUNT(ar.attendance_id) - SUM(CASE WHEN ar.status = 'Excused' THEN 1 ELSE 0 END), 0), 1) AS attendance_pct,
       SUM(CASE WHEN ar.status = 'Absent' THEN 1 ELSE 0 END) AS absences,
       SUM(CASE WHEN ar.status = 'Late'   THEN 1 ELSE 0 END) AS lates
FROM courses c
LEFT JOIN class_sections sec    ON sec.course_id = c.course_id
LEFT JOIN class_sessions cs     ON cs.section_id = sec.section_id
LEFT JOIN attendance_records ar ON ar.session_id = cs.session_id
GROUP BY c.course_id;

CREATE VIEW v_low_attendance AS
SELECT v.*
FROM v_student_section_attendance v
WHERE v.attendance_pct IS NOT NULL
  AND v.attendance_pct < (SELECT CAST(setting_value AS REAL) FROM system_settings WHERE setting_key = 'attendance_threshold');
`;
