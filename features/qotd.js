const fs = require('fs');
const path = require('path');

// ================================
// Configuration File Locations
// ================================

// Location of QOTD data
const qotdPath = path.join(
    __dirname,
    '..',
    'data',
    'qotd.json'
);

// Location of QOTD configuration
const qotdConfigPath = path.join(
    __dirname,
    '..',
    'config',
    'qotdconfig.json'
);

// How often the bot checks if it is time
// to post a QOTD
// 30 seconds = 30,000 milliseconds
const CHECK_INTERVAL = 1800000;

// ================================
// Helper Functions
// ================================

// Load QOTD data
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

// ================================
// Load QOTD Configuration
// ================================

function loadQotdConfig() {

    try {

        if (
            !fs.existsSync(
                qotdConfigPath
            )
        ) {

            console.error(
                'QOTD configuration file could not be found.'
            );

            return null;
        }

        return JSON.parse(
            fs.readFileSync(
                qotdConfigPath,
                'utf8'
            )
        );

    } catch (error) {

        console.error(
            'Error loading QOTD configuration:',
            error
        );

        return null;
    }
}

// ================================
// Save QOTD Data
// ================================

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
// Get Current Time in Configured Timezone
// ================================

function getConfiguredTime(
    timezone
) {

    const now =
        new Date();

    const formatter =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                timeZone:
                    timezone,

                year:
                    'numeric',

                month:
                    '2-digit',

                day:
                    '2-digit',

                hour:
                    '2-digit',

                minute:
                    '2-digit',

                hour12:
                    false
            }
        );

    const parts =
        formatter.formatToParts(
            now
        );

    const time = {};

    for (
        const part
        of parts
    ) {

        if (
            part.type !== 'literal'
        ) {

            time[
                part.type
            ] =
                part.value;
        }
    }

    return {

        year:
            Number(
                time.year
            ),

        month:
            Number(
                time.month
            ),

        day:
            Number(
                time.day
            ),

        hour:
            Number(
                time.hour
            ),

        minute:
            Number(
                time.minute
            )
    };
}

// ================================
// Check if QOTD Should Be Posted
// ================================

function isTimeForQotd(
    qotdData,
    qotdConfig
) {

    const currentTime =
        getConfiguredTime(
            qotdConfig.timezone
        );

    const currentHour =
        currentTime.hour;

    const currentMinute =
        currentTime.minute;

    // Check if the current time matches
    // the configured QOTD time
    return (

        currentHour ===
            qotdConfig.postHour

        &&

        currentMinute ===
            qotdConfig.postMinute
    );
}

// ================================
// Prevent Multiple Posts
// ================================

function wasPostedToday(
    qotdData,
    qotdConfig
) {

    if (
        !qotdData.lastPostedAt
    ) {

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
                timeZone:
                    qotdConfig.timezone,

                year:
                    'numeric',

                month:
                    '2-digit',

                day:
                    '2-digit'
            }
        );

    const currentFormatter =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                timeZone:
                    qotdConfig.timezone,

                year:
                    'numeric',

                month:
                    '2-digit',

                day:
                    '2-digit'
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
        lastPostedDate ===
        currentDate
    );
}

// ================================
// Post QOTD
// ================================

async function postQotd(
    client
) {

    // ================================
    // Load QOTD Data
    // ================================

    const qotdData =
        loadQotdData();

    if (
        !qotdData
    ) {

        return;
    }

    // ================================
    // Load QOTD Configuration
    // ================================

    const qotdConfig =
        loadQotdConfig();

    if (
        !qotdConfig
    ) {

        return;
    }

    // ================================
    // Check Required Configuration
    // ================================

    if (
        !qotdConfig.channelId
    ) {

        console.error(
            'QOTD channel ID has not been configured.'
        );

        return;
    }

    if (
        !qotdConfig.roleId
    ) {

        console.warn(
            'QOTD role ID has not been configured. No role will be pinged.'
        );
    }

    if (
        !qotdConfig.answerChannelId
    ) {

        console.error(
            'QOTD answer channel ID has not been configured.'
        );

        return;
    }

    if (
        !qotdConfig.timezone
    ) {

        console.error(
            'QOTD timezone has not been configured.'
        );

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
    // Check if Already Posted Today
    // ================================

    if (
        wasPostedToday(
            qotdData,
            qotdConfig
        )
    ) {

        return;
    }

    // ================================
    // Check Time
    // ================================

    if (
        !isTimeForQotd(
            qotdData,
            qotdConfig
        )
    ) {

        return;
    }

    // ================================
    // Get Discord Channel
    // ================================

    const channel =
        await client.channels
            .fetch(
                qotdConfig.channelId
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

    if (
        !channel
    ) {

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
        )

        &&

        qotdData.queuedQuestions.length >
            0
    ) {

        // Get the first question
        // in the queue
        const queuedQotd =
            qotdData.queuedQuestions[
                0
            ];

        question =
            queuedQotd.question;

        qotdType =
            'Queued QOTD';

        // Remove the question
        // from the queue
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

        // Make sure automatic
        // questions exist
        if (

            !Array.isArray(
                qotdData.questions
            )

            ||

            qotdData.questions.length ===
                0
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
            )

            ||

            qotdData.currentQuestionIndex <
                0

            ||

            qotdData.currentQuestionIndex >=
                qotdData.questions.length
        ) {

            qotdData.currentQuestionIndex =
                0;
        }

        // Get the current
        // automatic QOTD
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

        // Move to the next
        // automatic question
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
                qotdConfig.roleId
                    ? `<@&${qotdConfig.roleId}>`
                    : '',

            // QOTD Embed
            embeds: [

                {

                    title:
                        '🏔️ Question of the Day',

                    description:
                        `**${question}**\n\nProvide your answers in <#${qotdConfig.answerChannelId}>`,

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

            // Only allow the configured
            // role to be mentioned
            allowedMentions: {

                roles:
                    qotdConfig.roleId
                        ? [
                            qotdConfig.roleId
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

        // Get current time in
        // configured timezone
        const currentTime =
            getConfiguredTime(
                qotdConfig.timezone
            );

        console.log(

            `QOTD successfully posted at ${
                String(
                    currentTime.hour
                ).padStart(
                    2,
                    '0'
                )
            }:${
                String(
                    currentTime.minute
                ).padStart(
                    2,
                    '0'
                )
            } ${qotdConfig.timezone}.`

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

function startQotdScheduler(
    client
) {

    console.log(
        'QOTD scheduler started.'
    );

    const qotdConfig =
        loadQotdConfig();

    if (
        qotdConfig
    ) {

        console.log(
            `QOTD timezone: ${qotdConfig.timezone}`
        );

        console.log(
            `QOTD scheduled time: ${
                String(
                    qotdConfig.postHour
                ).padStart(
                    2,
                    '0'
                )
            }:${
                String(
                    qotdConfig.postMinute
                ).padStart(
                    2,
                    '0'
                )
            }`
        );
    }

    // Check immediately when
    // the bot starts
    postQotd(
        client
    );

    // Continue checking periodically
    setInterval(

        () =>
            postQotd(
                client
            ),

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

