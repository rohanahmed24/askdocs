# Incident runbook

## Severity levels
SEV1 means the product is down or customer data is at risk. SEV2 means an important feature is broken for many customers. SEV3 covers everything else. The first person to notice a problem opens an incident in the status tool and picks a severity.

## Telling customers
If the production server is down for more than one hour, the support team must notify all customers by email and update the public status page. For a SEV1 the first message goes out within 30 minutes, and then a new update every hour until it is fixed.

## On-call
The on-call engineer changes every Monday at 10:00. The on-call phone is passed on at the weekly handover meeting. If the on-call person does not answer within 10 minutes, the alert goes to the engineering manager.

## Common error codes
Error E-4021 means the payment gateway timed out. Retry the payment up to three times, one minute apart, and then tell the customer to try another card. Error E-5003 means the database connection pool is exhausted. Restart the background worker first, and check for long-running queries before restarting the web servers.

## After the incident
Write a short review within five working days. It must say what happened, why, and what will change. Reviews do not blame people. They are shared with the whole company.

## Backups
Database backups run every night and are tested once a month by restoring them into a separate environment.
