# Entity–Relationship Diagram

GitHub renders the diagram below automatically.

```mermaid
erDiagram
    DEPARTMENTS ||--o{ PROGRAMS : offers
    DEPARTMENTS ||--o{ COURSES : owns
    DEPARTMENTS ||--o{ INSTRUCTORS : employs
    PROGRAMS ||--o{ STUDENTS : "enrolls in"
    USERS |o--o| STUDENTS : "logs in as"
    USERS |o--o| INSTRUCTORS : "logs in as"
    COURSES ||--o{ CLASS_SECTIONS : "is taught as"
    ACADEMIC_TERMS ||--o{ CLASS_SECTIONS : schedules
    INSTRUCTORS |o--o{ CLASS_SECTIONS : teaches
    CLASSROOMS |o--o{ CLASS_SECTIONS : hosts
    CLASS_SECTIONS ||--o{ SECTION_SCHEDULES : "meets on"
    CLASS_SECTIONS ||--o{ ENROLLMENTS : has
    STUDENTS ||--o{ ENROLLMENTS : makes
    CLASS_SECTIONS ||--o{ CLASS_SESSIONS : holds
    SECTION_SCHEDULES |o--o{ CLASS_SESSIONS : generates
    CLASS_SESSIONS ||--o{ ATTENDANCE_RECORDS : records
    STUDENTS ||--o{ ATTENDANCE_RECORDS : receives
    USERS |o--o{ ATTENDANCE_RECORDS : "recorded by"
    ATTENDANCE_RECORDS ||--o{ ATTENDANCE_AUDIT : "changes logged in"

    DEPARTMENTS { int department_id PK
      string department_code UK
      string department_name UK }
    PROGRAMS { int program_id PK
      int department_id FK
      string program_code UK
      string program_name }
    ACADEMIC_TERMS { int term_id PK
      string term_name UK
      date start_date
      date end_date
      bool is_current }
    CLASSROOMS { int room_id PK
      string building
      string room_number
      int capacity }
    USERS { int user_id PK
      string username UK
      string password_hash
      enum role
      bool is_active }
    STUDENTS { int student_id PK
      int user_id FK
      string student_no UK
      string first_name
      string last_name
      string email UK
      int program_id FK
      int year_level }
    INSTRUCTORS { int instructor_id PK
      int user_id FK
      string staff_no UK
      string first_name
      string last_name
      string email UK
      int department_id FK }
    COURSES { int course_id PK
      string course_code UK
      string course_title
      int credits
      int department_id FK }
    CLASS_SECTIONS { int section_id PK
      int course_id FK
      int term_id FK
      string section_code
      int instructor_id FK
      int room_id FK
      int max_capacity }
    SECTION_SCHEDULES { int schedule_id PK
      int section_id FK
      int day_of_week
      time start_time
      time end_time }
    ENROLLMENTS { int enrollment_id PK
      int student_id FK
      int section_id FK
      date enrolled_on
      enum status }
    CLASS_SESSIONS { int session_id PK
      int section_id FK
      int schedule_id FK
      date session_date
      time start_time
      time end_time
      string topic }
    ATTENDANCE_RECORDS { int attendance_id PK
      int session_id FK
      int student_id FK
      enum status
      time check_in_time
      string remarks
      int recorded_by FK
      timestamp recorded_at }
    ATTENDANCE_AUDIT { int audit_id PK
      int attendance_id
      enum old_status
      enum new_status
      int changed_by
      timestamp changed_at }
```

## Key business rules and constraints

| Rule | How it is enforced |
|---|---|
| A student can't be enrolled in the same section twice | `UNIQUE (student_id, section_id)` on `enrollments` |
| A student has only one attendance record per session | `UNIQUE (session_id, student_id)` on `attendance_records` |
| Attendance status is Present, Absent, Late or Excused | `CHECK` constraint (SQLite) / `ENUM` type (PostgreSQL) |
| Only enrolled students can receive attendance | trigger `trg_attendance_requires_enrollment` |
| Sections can't go over capacity | trigger `trg_enrollment_capacity` |
| Every status change is logged | trigger `trg_attendance_audit` → `attendance_audit` |
| A section is unique per course, term and section code | `UNIQUE (course_id, term_id, section_code)` |
| No duplicate sessions | `UNIQUE (section_id, session_date, start_time)` |
| Referential integrity | foreign keys with `RESTRICT`, `CASCADE` or `SET NULL` chosen for each relationship |

## Normalization (3NF)

- **1NF:** every column holds one atomic value. A section's weekly meetings are rows in `section_schedules` rather than a list in one column.
- **2NF:** every table has a single-column surrogate primary key, so no attribute depends on only part of a key. Natural keys (`student_no`, `course_code`, `username`) are kept as `UNIQUE` candidate keys.
- **3NF:** no non-key attribute depends on another non-key attribute:
  - Department names live only in `departments`, not in `courses` or `instructors`.
  - Program details live in `programs`, and a student stores only `program_id`.
  - Course title and credits live in `courses`, not in `class_sections`.
  - Room capacity lives in `classrooms`.
  - Login data (`users`) is kept separate from personal data (`students`, `instructors`).
  - Derived values such as attendance percentage are **not stored**. They are calculated in views (`v_student_section_attendance`, etc.), so they can never become inconsistent.

## Attendance percentage

```
attendance % = (Present + Late) / (sessions recorded − Excused) × 100
```

Excused absences are left out of the denominator, so they don't count against the student.
