-- =====================================================================
-- Class Attendance Management System — PostgreSQL schema (3NF)
-- Run:  psql -U postgres -c "CREATE DATABASE cams;"
--       psql -U postgres -d cams -f 01_schema.sql
-- =====================================================================
DROP SCHEMA IF EXISTS cams CASCADE;
CREATE SCHEMA cams;
SET search_path TO cams;

-- Domain types keep status values consistent across tables
CREATE TYPE user_role         AS ENUM ('Administrator', 'Instructor', 'Student');
CREATE TYPE attendance_status AS ENUM ('Present', 'Absent', 'Late', 'Excused');
CREATE TYPE enrollment_status AS ENUM ('Active', 'Dropped');

-- ---------- Reference data ----------
CREATE TABLE departments (
  department_id   SERIAL PRIMARY KEY,
  department_code VARCHAR(10)  NOT NULL UNIQUE,
  department_name VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE programs (
  program_id    SERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(department_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  program_code  VARCHAR(12)  NOT NULL UNIQUE,
  program_name  VARCHAR(120) NOT NULL
);

CREATE TABLE academic_terms (
  term_id    SERIAL PRIMARY KEY,
  term_name  VARCHAR(40) NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT chk_term_dates CHECK (end_date > start_date)
);
-- At most one current term
CREATE UNIQUE INDEX uq_one_current_term ON academic_terms (is_current) WHERE is_current;

CREATE TABLE classrooms (
  room_id     SERIAL PRIMARY KEY,
  building    VARCHAR(60) NOT NULL,
  room_number VARCHAR(20) NOT NULL,
  capacity    INT NOT NULL CHECK (capacity > 0),
  UNIQUE (building, room_number)
);

-- ---------- Users and roles ----------
CREATE TABLE users (
  user_id       SERIAL PRIMARY KEY,
  username      VARCHAR(40) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,           -- salted hash, never plain text
  role          user_role NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT now(),
  last_login_at TIMESTAMP
);

CREATE TABLE students (
  student_id  SERIAL PRIMARY KEY,
  user_id     INT UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
  student_no  VARCHAR(20)  NOT NULL UNIQUE,
  first_name  VARCHAR(60)  NOT NULL,
  last_name   VARCHAR(60)  NOT NULL,
  email       VARCHAR(120) NOT NULL UNIQUE CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       VARCHAR(30),
  program_id  INT NOT NULL REFERENCES programs(program_id) ON DELETE RESTRICT,
  year_level  SMALLINT NOT NULL CHECK (year_level BETWEEN 1 AND 6),
  admitted_on DATE NOT NULL
);

CREATE TABLE instructors (
  instructor_id SERIAL PRIMARY KEY,
  user_id       INT UNIQUE REFERENCES users(user_id) ON DELETE SET NULL,
  staff_no      VARCHAR(20)  NOT NULL UNIQUE,
  first_name    VARCHAR(60)  NOT NULL,
  last_name     VARCHAR(60)  NOT NULL,
  email         VARCHAR(120) NOT NULL UNIQUE CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone         VARCHAR(30),
  department_id INT NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT
);

-- ---------- Courses, sections, schedules ----------
CREATE TABLE courses (
  course_id     SERIAL PRIMARY KEY,
  course_code   VARCHAR(12)  NOT NULL UNIQUE,
  course_title  VARCHAR(120) NOT NULL,
  credits       SMALLINT NOT NULL CHECK (credits BETWEEN 1 AND 6),
  department_id INT NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT
);

CREATE TABLE class_sections (
  section_id    SERIAL PRIMARY KEY,
  course_id     INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  term_id       INT NOT NULL REFERENCES academic_terms(term_id) ON DELETE RESTRICT,
  section_code  VARCHAR(5) NOT NULL,
  instructor_id INT REFERENCES instructors(instructor_id) ON DELETE SET NULL,
  room_id       INT REFERENCES classrooms(room_id) ON DELETE SET NULL,
  max_capacity  INT NOT NULL CHECK (max_capacity > 0),
  UNIQUE (course_id, term_id, section_code)
);

CREATE TABLE section_schedules (
  schedule_id SERIAL PRIMARY KEY,
  section_id  INT NOT NULL REFERENCES class_sections(section_id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),   -- ISO: 1 = Monday
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  CHECK (end_time > start_time),
  UNIQUE (section_id, day_of_week, start_time)
);

-- ---------- Enrollment ----------
CREATE TABLE enrollments (
  enrollment_id SERIAL PRIMARY KEY,
  student_id    INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  section_id    INT NOT NULL REFERENCES class_sections(section_id) ON DELETE CASCADE,
  enrolled_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  status        enrollment_status NOT NULL DEFAULT 'Active',
  CONSTRAINT uq_enrollment UNIQUE (student_id, section_id)          -- no duplicate enrollment
);

-- ---------- Attendance ----------
CREATE TABLE class_sessions (
  session_id   SERIAL PRIMARY KEY,
  section_id   INT NOT NULL REFERENCES class_sections(section_id) ON DELETE CASCADE,
  schedule_id  INT REFERENCES section_schedules(schedule_id) ON DELETE SET NULL,
  session_date DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  topic        VARCHAR(160),
  CHECK (end_time > start_time),
  UNIQUE (section_id, session_date, start_time)
);

CREATE TABLE attendance_records (
  attendance_id SERIAL PRIMARY KEY,
  session_id    INT NOT NULL REFERENCES class_sessions(session_id) ON DELETE CASCADE,
  student_id    INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  status        attendance_status NOT NULL,
  check_in_time TIME,
  remarks       VARCHAR(255),
  recorded_by   INT REFERENCES users(user_id) ON DELETE SET NULL,
  recorded_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP,
  CONSTRAINT uq_attendance UNIQUE (session_id, student_id)          -- one record per student per session
);

CREATE TABLE attendance_audit (
  audit_id      SERIAL PRIMARY KEY,
  attendance_id INT NOT NULL,
  old_status    attendance_status,
  new_status    attendance_status,
  changed_by    INT,
  changed_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  setting_key   VARCHAR(60) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
);

-- ---------- Indexes ----------
CREATE INDEX idx_sections_instructor ON class_sections(instructor_id);
CREATE INDEX idx_sections_term       ON class_sections(term_id);
CREATE INDEX idx_enroll_section      ON enrollments(section_id);
CREATE INDEX idx_sessions_section_dt ON class_sessions(section_id, session_date);
CREATE INDEX idx_sessions_date       ON class_sessions(session_date);
CREATE INDEX idx_attendance_student  ON attendance_records(student_id);
CREATE INDEX idx_attendance_status   ON attendance_records(status);
CREATE INDEX idx_students_name       ON students(last_name, first_name);
