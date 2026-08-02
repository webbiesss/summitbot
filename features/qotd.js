const fs = require('fs');
const path = require('path');

// ================================
// Configuration
// ================================

// Location of QOTD data
const qotdPath = path.join(
    __dirname,
    '..',
    'data',
    'qotd.json'
);

// Timezone used for QOTD scheduling
const QOTD_TIMEZONE = 'America/Vancouver';

// How often the bot checks if it is time
// to post a QOTD
// 30 seconds = 30,000 milliseconds
const CHECK_INTERVAL = 30 * 1000;

// Channel where users submit QOTD answers
const ANSWER_CHANNEL_ID = '1533265327868346618';

// ================================
// Helper Functions
// ================================

function loadQotdData() {

    try {

        if (!fs.existsSync(qotdPath)) {

            console.error(
                'QOTD data file could not be found.'
            );

            return null;
        }

        return JSON.parse(
            fs.readFileSync(
                qotdPath,
                'utf8'
            )
        );

    } catch (error) {

        console.error(
            'Error loading QOTD data:',
            error
        );

        return null;
    }
}

function saveQotdData(qotdData) {

    try {

        fs.writeFileSync(
            qotdPath,
            JSON.stringify(
                qotdData,
                null,
                4
            )
        );

        return true;

    } catch (error) {

        console.error(
            'Error saving QOTD data:',
            error
        );

        return false;
    }
}

// ================================
// Get Current Time in Vancouver
// ================================

function getVancouverTime() {

    const now = new Date();

    const formatter = new Intl.DateTimeFormat(
        'en-CA',
        {
            timeZone: QOTD_TIMEZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }
    );

    const parts = formatter.formatToParts(now);

    const time = {};

    for (const part of parts) {

        if (part.type !== 'literal') {

            time[part.type] = part.value;
        }
    }

    return {
        year: Number(time.year),
        month: Number(time.month),
        day: Number(time.day),
        hour: Number(time.hour),
        minute: Number(time.minute)
    };
}

// ================================
// Check if QOTD Should Be Posted
// ================================

function isTimeForQotd(qotdData) {

    const vancouverTime =
        getVancouverTime();

    const currentHour =
        vancouverTime.hour;

    const currentMinute =
        vancouverTime.minute;

    // Check if the current Vancouver time
    // matches the configured QOTD time
    return (
        currentHour === qotdData.postHour &&
        currentMinute === qotdData.postMinute
    );
}

// ================================
// Prevent Multiple Posts
// ================================

function wasPostedToday(qotdData) {

    if (!qotdData.lastPostedAt) {

        return false;
    }

    const lastPosted =
        new Date(
            qotdData.lastPostedAt
        );

    const lastPostedFormatter =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                timeZone: QOTD_TIMEZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }
        );

    const currentFormatter =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                timeZone: QOTD_TIMEZONE,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }
        );

    const lastPostedDate =
        lastPostedFormatter.format(
            lastPosted
        );

    const currentDate =
        currentFormatter.format(
            new Date()
        );

    return (
        lastPostedDate === currentDate
    );
}

// ================================
// Post QOTD
// ================================

async function postQotd(client) {

    const qotdData =
        loadQotdData();

    if (!qotdData) {

        return;
    }

    // ================================
    // Check if QOTD is Enabled
    // ================================

    if (
        qotdData.enabled === false
    ) {

        return;
    }

    // ================================
    // Check QOTD Channel
    // ================================

    if (
        !qotdData.channelId
    ) {

        console.log(
            'QOTD channel has not been configured yet.'
        );

        return;
    }

    // ================================
    // Check if Already Posted Today
    // ================================

    if (
        wasPostedToday(qotdData)
    ) {

        return;
    }

    // ================================
    // Check Time
    // ================================

    if (
        !isTimeForQotd(qotdData)
    ) {

        return;
    }

    // ================================
    // Get Discord Channel
    // ================================

    const channel =
        await client.channels
            .fetch(
                qotdData.channelId
            )
            .catch(
                error => {

                    console.error(
                        'Error finding QOTD channel:',
                        error
                    );

                    return null;
                }
            );

    if (!channel) {

        return;
    }

    // ================================
    // Determine QOTD
    // ================================

    let question;
    let qotdType;

    // ================================
    // Priority 1:
    // Manually Queued QOTDs
    // ================================

    if (
        Array.isArray(
            qotdData.queuedQuestions
        ) &&
        qotdData.queuedQuestions.length > 0
    ) {

        // Get the first question in the queue
        const queuedQotd =
            qotdData.queuedQuestions[0];

        question =
            queuedQotd.question;

        qotdType =
            'Queued QOTD';

        // Remove the question from
        // the queue
        qotdData.queuedQuestions.shift();

        console.log(
            `Posting queued QOTD: ${question}`
        );

    }

    // ================================
    // Priority 2:
    // Automatic QOTDs
    // ================================

    else {

        // Make sure automatic questions exist
        if (
            !Array.isArray(
                qotdData.questions
            ) ||
            qotdData.questions.length === 0
        ) {

            console.error(
                'No automatic QOTDs are available.'
            );

            return;
        }

        // Make sure currentQuestionIndex
        // is valid
        if (
            !Number.isInteger(
                qotdData.currentQuestionIndex
            ) ||
            qotdData.currentQuestionIndex < 0 ||
            qotdData.currentQuestionIndex >=
                qotdData.questions.length
        ) {

            qotdData.currentQuestionIndex =
                0;
        }

        // Get the current automatic QOTD
        question =
            qotdData.questions[
                qotdData.currentQuestionIndex
            ];

        qotdType =
            'Question of the Day';

        console.log(
            `Posting automatic QOTD #${
                qotdData.currentQuestionIndex + 1
            }: ${question}`
        );

        // Move to the next automatic question
        qotdData.currentQuestionIndex++;

        // Loop back to the first question
        // when reaching the end
        if (
            qotdData.currentQuestionIndex >=
            qotdData.questions.length
        ) {

            qotdData.currentQuestionIndex =
                0;
        }
    }

    // ================================
    // Send QOTD
    // ================================

    try {

        await channel.send({

            // Ping the configured QOTD role
            content:
                qotdData.roleId
                    ? `<@&${qotdData.roleId}>`
                    : '',

            // QOTD Embed
            embeds: [

                {

                    title:
                        '🏔️ Question of the Day',

                    description:
                        `**${question}**\n\nProvides your answers in <#${ANSWER_CHANNEL_ID}>`,

                    color:
                        0x2B2D31,

                    footer: {

                        text:
                            qotdType
                    },

                    timestamp:
                        new Date().toISOString()
                }
            ],

            // Only allow the configured role
            // to be mentioned
            allowedMentions: {

                roles:
                    qotdData.roleId
                        ? [
                            qotdData.roleId
                        ]
                        : []
            }
        });

        // ================================
        // Save Posting Information
        // ================================

        qotdData.lastPostedAt =
            new Date().toISOString();

        // Save updated queue/index
        saveQotdData(
            qotdData
        );

        // Get current Vancouver time
        const vancouverTime =
            getVancouverTime();

        console.log(
            `QOTD successfully posted at ${
                String(
                    vancouverTime.hour
                ).padStart(2, '0')
            }:${
                String(
                    vancouverTime.minute
                ).padStart(2, '0')
            } Vancouver time.`
        );

    } catch (error) {

        console.error(
            'Error posting QOTD:',
            error
        );
    }
}

// ================================
// Start QOTD Scheduler
// ================================

function startQotdScheduler(client) {

    console.log(
        `QOTD scheduler started.`
    );

    console.log(
        `QOTD timezone: ${QOTD_TIMEZONE}`
    );

    // Check immediately when
    // the bot starts
    postQotd(client);

    // Continue checking periodically
    setInterval(
        () => postQotd(client),
        CHECK_INTERVAL
    );
}

// ================================
// Export
// ================================

module.exports = {

    startQotdScheduler,

    postQotd
};
