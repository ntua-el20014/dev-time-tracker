### Row Level Security (RLS)

Every table has RLS enabled. All policies use PostgreSQL's `auth.uid()` and helper functions (`get_current_user_org_id()`, `get_current_user_role()`, `is_user_admin()`, `is_user_admin_or_manager()`, `same_org()`) defined as `SECURITY DEFINER` to avoid infinite recursion.

#### Organizations

| Operation | Policy                                                 |
| --------- | ------------------------------------------------------ |
| SELECT    | Users can view their own organization                  |
| SELECT    | Users can view organizations they've requested to join |
| UPDATE    | Only admins can update their organization              |

#### User Profiles

| Operation | Policy                                                      |
| --------- | ----------------------------------------------------------- |
| SELECT    | Users can view their own profile                            |
| SELECT    | Users can view profiles of members in the same organization |
| INSERT    | Users can create their own profile                          |
| UPDATE    | Users can update their own profile                          |
| UPDATE    | Admins can update user roles within their organization      |

#### Organization Join Requests

| Operation | Policy                                                    |
| --------- | --------------------------------------------------------- |
| SELECT    | Users can view their own join requests                    |
| SELECT    | Admins can view requests for their organization           |
| INSERT    | Users can create join requests                            |
| DELETE    | Users can cancel their own pending requests               |
| UPDATE    | Admins can approve/reject requests for their organization |

#### Projects (`cloud_projects`)

| Operation | Policy                                                                |
| --------- | --------------------------------------------------------------------- |
| SELECT    | Users can view their own personal projects (`scope = 'personal'`)     |
| SELECT    | Organization members can view org projects (`scope = 'organization'`) |
| INSERT    | Any user can create personal projects                                 |
| INSERT    | Admins and managers can create organization projects                  |
| UPDATE    | Project managers can update their own projects                        |
| UPDATE    | Admins can update any org project                                     |
| DELETE    | Project managers can delete their own projects                        |

#### Project Members

| Operation | Policy                                                            |
| --------- | ----------------------------------------------------------------- |
| SELECT    | Users can view members of projects they manage or belong to (org) |
| ALL       | Project managers have full control over their project's members   |

#### Time Tracking Sessions

| Operation | Policy                                                      |
| --------- | ----------------------------------------------------------- |
| SELECT    | Users can view their own sessions                           |
| SELECT    | Admins/managers can view sessions within their organization |
| INSERT    | Users can create their own sessions                         |
| UPDATE    | Users can update their own sessions                         |
| DELETE    | Users can delete their own sessions                         |

#### Usage Logs

| Operation | Policy                                       |
| --------- | -------------------------------------------- |
| SELECT    | Users can view their own usage logs          |
| SELECT    | Admins/managers can view org-wide usage logs |
| INSERT    | Users can create their own usage logs        |
| UPDATE    | Users can update their own usage logs        |
| DELETE    | Users can delete their own usage logs        |

#### Daily Usage Summary

| Operation | Policy                                      |
| --------- | ------------------------------------------- |
| SELECT    | Users can view their own summaries          |
| SELECT    | Admins/managers can view org-wide summaries |
| ALL       | Users can manage their own summary records  |

#### Tags (`user_tags`) & Session Tags

| Operation | Policy                                      |
| --------- | ------------------------------------------- |
| ALL       | Users have full CRUD on their own tags      |
| ALL       | Users can manage tags on their own sessions |

#### Scheduled Session Tags

| Operation | Policy                                                |
| --------- | ----------------------------------------------------- |
| ALL       | Users can manage tags on their own scheduled sessions |

#### Daily Work Goals

| Operation | Policy                                                      |
| --------- | ----------------------------------------------------------- |
| ALL       | Users have full CRUD on their own goals                     |
| SELECT    | Admins can view goals for all members in their organization |

#### Scheduled Work Sessions

| Operation | Policy                                               |
| --------- | ---------------------------------------------------- |
| ALL       | Users have full CRUD on their own scheduled sessions |

#### User Preferences

| Operation | Policy                                      |
| --------- | ------------------------------------------- |
| ALL       | Users can manage only their own preferences |

> **Summary:** Users always have full control of their own data. Organization admins and managers get read access to team data (sessions, usage, goals). Only admins can modify organization settings and user roles. All policies are defined in [`database/schema.sql`](./database/schema.sql).
