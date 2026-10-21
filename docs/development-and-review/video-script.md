# Findr — voiceover script

Written against **Findr-demo-cut3.mp4**, which runs **4:52**. Timecodes are cues, not hard marks: start each line at or just after the time shown and it will sit under the right picture.

About 620 words, which is a relaxed 127 words a minute over this length. The AWS section has been given extra room in the edit, so there is no need to hurry through it. If you finish a line early, leave the gap. Silence over a screen the viewer is reading is fine and sounds far better than rushing.

**Recording tips.** Record in one pass with the video playing so you can see what you are talking about. Say the model numbers slowly, they are the marks. If you fluff a line, pause for three seconds and say it again from the start of the sentence, then keep the better take in the edit.

---

## Title card

**0:00**
> Hi, I'm Mohammed Hannan Noor, XXXXXXXX, class group PC02. This is Findr, a campus lost and found platform built on AWS.

---

## The website

**0:05** *(home page)*
> So this is Findr. Lose something on campus, or find something, and it goes up here. Twenty-eight reports on it right now, twenty-seven still open.

**0:12** *(the "anyone can say it's theirs" section)*
> Anyone can claim an item, so Findr checks first. More on that later.

**0:16** *(recent reports)*
> Recent reports, straight off the home page.

**0:27** *(browse)*
> This is Browse. Everything that's been reported. Filter it by category, or by whether it's lost or found.

**0:41** *(campus map)*
> And the map. Every report with a location, on Amazon Location Service. Each pin is the actual photo of the item.

---

## Reporting an item, and the trained model

**0:50** *(report found page)*
> Now the part I spent the most time on. I'm reporting a found item, and the only thing I am going to give it is a photograph.

**1:00** *(analysis running)*
> Two models look at that image.

**1:03** *(the custom model block)*
> This top block is my own model. It's an Amazon Rekognition Custom Labels classifier, trained on 398 images across the eight categories a campus lost property counter actually files items under. It scored an F1 of 0.955, with an average precision of 0.976. Here it has returned Umbrella, at 100 percent.

**1:07** *(pretrained chips)*
> Underneath, kept deliberately separate, are the labels from Amazon's pretrained model. Useful as supporting detail, but it doesn't know my categories. In testing it called a set of keys a weapon, and a bottle a mason jar, which is exactly why I trained my own.

**1:09** *(category and description filled in)*
> The category comes from my model's answer, and this description was written by Amazon Bedrock, which receives the actual image along with that classification and is told to treat it as correct.

**1:14** *(private details field)*
> Down here I add a private detail. This never appears on the public listing. It is what the ownership check runs on in a moment.

**1:31** *(my reports)*
> Submitted, and there it is under My Reports.

---

## The notification

**1:47** *(gmail)*
> Amazon SNS emails a notification whenever a report is created. If that email ever fails, it's logged and the report still goes through.

---

## Proving ownership

**1:57** *(signed in as the claimant)*
> Now the ownership check. I'm a different student here, claiming a wallet somebody else handed in.

**2:16** *(the two questions)*
> Amazon Bedrock has turned the finder's private facts into questions. Neither question gives away its own fact. They ask about the condition, and about what is inside, and leave me to supply the detail.

**2:18** *(vague answers submitted)*
> First I'll answer vaguely, the way somebody who had only read the listing would.

**2:20** *(20 percent, refused)*
> Twenty percent. The claim is refused.

**2:26** *(second attempt)*
> Now the real answers, in my own words rather than copied wording.

**2:32** *(90 percent, verified)*
> Ninety percent, past the sixty percent threshold. The claim is approved and the item is marked as Claimed. The finder is emailed either way, including the score, so a person can still overrule it.

**2:41** *(chinese, then malay)*
> And any listing can be read in Chinese, Malay or Tamil. Amazon Comprehend detects the source language automatically, so nobody has to tell the platform what language a report was written in.

---

## Behind it, on AWS

**2:49** *(rekognition custom labels)*
> Here is what sits behind all of that. This is the trained model in Rekognition Custom Labels, and its evaluation results.

**2:56** *(per-label table)*
> Eight labels, 398 images, an F1 of 0.955. Six of the eight labels have a precision of one. That matters here, because the classification pre-fills a field the user confirms, so a confidently wrong category is worse than a missed one.

**2:59** *(lambda functions)*
> Six Lambda functions hold all of the application logic.

**3:10** *(findr-images code)*
> This is findr-images, the one that runs moderation, then my custom model, then the pretrained labels, then the Bedrock description.

**3:21** *(api gateway resources)*
> They sit behind an API Gateway REST API.

**3:29** *(authorizers)*
> Every protected method uses a Cognito authoriser, so the token is validated before any of my code runs. An invalid request never costs a Lambda invocation.

**3:37** *(dynamodb items)*
> Reports are written to DynamoDB. This is the umbrella I reported a couple of minutes ago.

**4:06** *(s3 buckets)*
> Two S3 buckets, one for the site and one for the photographs.

**4:16** *(block public access)*
> Block Public Access is on. Neither bucket is readable directly.

**4:20** *(cloudfront origins)*
> CloudFront serves the site over HTTPS and reads that bucket through Origin Access Control, so the storage is never exposed.

**4:24** *(cloudwatch)*
> And CloudWatch has the logs from the request I made earlier.

---

## Closing card

**4:44**
> Fifteen AWS services, and nothing running while the site is idle. The next thing I would build is automatic matching on submission, so that Findr contacts people instead of waiting to be searched. Thanks for watching.

---

## Words that are worth slowing down for

These are the ones a marker is listening for. Say them clearly and give each a beat after it.

- **0.955** and **0.976** — the model's F1 and average precision
- **398 images**, **eight categories**
- **Rekognition Custom Labels**, **Bedrock**, **Cognito authoriser**, **Origin Access Control**, **Comprehend**, **Location Service**
- **Twenty percent** and **ninety percent** — the two verification outcomes
