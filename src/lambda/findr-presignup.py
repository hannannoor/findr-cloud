"""
findr-presignup
cognito calls this by itself whenever someone registers, it's not an api route

auto-confirms new accounts so signup goes straight into login instead of
making you go dig a 6 digit code out of your email mid-demo.
production would leave verification on, this is a demo tradeoff

attach it: cognito -> user pool -> extensions -> pre sign-up trigger
needs no extra iam permissions
"""


def lambda_handler(event, context):
    # only auto-confirm normal signups, admin-created and federated users
    # have their own flows and shouldn't be touched
    if event.get("triggerSource") == "PreSignUp_SignUp":
        event["response"]["autoConfirmUser"] = True

        # verify the email too or password resets won't send
        if event["request"]["userAttributes"].get("email"):
            event["response"]["autoVerifyEmail"] = True

    # cognito expects the whole event object back
    return event
