#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/audio_fifo.h>
#include <libavutil/channel_layout.h>
#include <libavutil/error.h>
#include <libswresample/swresample.h>

typedef struct {
    AVFormatContext *video, *audio, *output;
    AVCodecContext *decoder, *encoder;
    SwrContext *resampler;
    AVAudioFifo *fifo;
    AVFrame *decoded, *converted, *frame;
    AVPacket *input, *picture, *sound;
    int vi, ai, have_picture, have_sound, video_eof, input_eof, decoder_eof, encoder_flushed, audio_eof, done;
    int64_t audio_pts;
} ArkMovie;

void ark_media_close(ArkMovie *m) {
    if (!m) return;
    av_packet_free(&m->input);
    av_packet_free(&m->picture);
    av_packet_free(&m->sound);
    av_frame_free(&m->decoded);
    av_frame_free(&m->converted);
    av_frame_free(&m->frame);
    av_audio_fifo_free(m->fifo);
    swr_free(&m->resampler);
    avcodec_free_context(&m->decoder);
    avcodec_free_context(&m->encoder);
    avformat_close_input(&m->video);
    avformat_close_input(&m->audio);
    if (m->output) {
        avio_closep(&m->output->pb);
        avformat_free_context(m->output);
    }
    av_free(m);
}

#define CHECK(call) do { if ((error = (call)) < 0) goto failed; } while (0)

ArkMovie *ark_media_open(const char *video, const char *audio, const char *output, int *failure) {
    int error = AVERROR(ENOMEM);
    ArkMovie *m = av_mallocz(sizeof(*m));
    if (!m) { *failure = error; return NULL; }
    CHECK(avformat_open_input(&m->video, video, NULL, NULL));
    CHECK(avformat_find_stream_info(m->video, NULL));
    CHECK(m->vi = av_find_best_stream(m->video, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0));
    CHECK(avformat_open_input(&m->audio, audio, NULL, NULL));
    CHECK(avformat_find_stream_info(m->audio, NULL));
    CHECK(m->ai = av_find_best_stream(m->audio, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0));
    AVCodecParameters *vp = m->video->streams[m->vi]->codecpar;
    AVCodecParameters *ap = m->audio->streams[m->ai]->codecpar;
    if (vp->codec_id != AV_CODEC_ID_VP9 || ap->codec_id != AV_CODEC_ID_ADPCM_ADX) { error = AVERROR_INVALIDDATA; goto failed; }
    const AVCodec *decoder = avcodec_find_decoder(ap->codec_id);
    const AVCodec *encoder = avcodec_find_encoder(AV_CODEC_ID_FLAC);
    if (!decoder || !encoder) { error = AVERROR_DECODER_NOT_FOUND; goto failed; }
    m->decoder = avcodec_alloc_context3(decoder);
    m->encoder = avcodec_alloc_context3(encoder);
    if (!m->decoder || !m->encoder) { error = AVERROR(ENOMEM); goto failed; }
    CHECK(avcodec_parameters_to_context(m->decoder, ap));
    m->decoder->thread_count = 1;
    CHECK(avcodec_open2(m->decoder, decoder, NULL));
    CHECK(avformat_alloc_output_context2(&m->output, NULL, "mp4", output));
    m->output->strict_std_compliance = FF_COMPLIANCE_EXPERIMENTAL;
    AVStream *v = avformat_new_stream(m->output, NULL);
    AVStream *a = avformat_new_stream(m->output, NULL);
    if (!v || !a) { error = AVERROR(ENOMEM); goto failed; }
    CHECK(avcodec_parameters_copy(v->codecpar, vp));
    v->codecpar->codec_tag = 0;
    v->time_base = m->video->streams[m->vi]->time_base;
    v->avg_frame_rate = m->video->streams[m->vi]->avg_frame_rate;
    m->encoder->sample_rate = m->decoder->sample_rate;
    m->encoder->sample_fmt = AV_SAMPLE_FMT_S16;
    m->encoder->time_base = (AVRational){1, m->encoder->sample_rate};
    m->encoder->thread_count = 1;
    m->encoder->strict_std_compliance = FF_COMPLIANCE_EXPERIMENTAL;
    CHECK(av_channel_layout_copy(&m->encoder->ch_layout, &m->decoder->ch_layout));
    if (m->output->oformat->flags & AVFMT_GLOBALHEADER) m->encoder->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    CHECK(avcodec_open2(m->encoder, encoder, NULL));
    CHECK(avcodec_parameters_from_context(a->codecpar, m->encoder));
    a->time_base = m->encoder->time_base;
    CHECK(swr_alloc_set_opts2(&m->resampler, &m->encoder->ch_layout, m->encoder->sample_fmt, m->encoder->sample_rate,
                             &m->decoder->ch_layout, m->decoder->sample_fmt, m->decoder->sample_rate, 0, NULL));
    CHECK(swr_init(m->resampler));
    m->fifo = av_audio_fifo_alloc(m->encoder->sample_fmt, m->encoder->ch_layout.nb_channels, m->encoder->frame_size * 2);
    m->decoded = av_frame_alloc(); m->converted = av_frame_alloc(); m->frame = av_frame_alloc();
    m->input = av_packet_alloc(); m->picture = av_packet_alloc(); m->sound = av_packet_alloc();
    if (!m->fifo || !m->decoded || !m->converted || !m->frame || !m->input || !m->picture || !m->sound) { error = AVERROR(ENOMEM); goto failed; }
    CHECK(avio_open(&m->output->pb, output, AVIO_FLAG_WRITE));
    AVDictionary *options = NULL;
    av_dict_set(&options, "movflags", "+faststart", 0);
    error = avformat_write_header(m->output, &options);
    av_dict_free(&options);
    if (error < 0) goto failed;
    *failure = 0;
    return m;
failed:
    *failure = error;
    ark_media_close(m);
    return NULL;
}

static int convert_audio(ArkMovie *m) {
    int error;
    av_frame_unref(m->converted);
    m->converted->format = m->encoder->sample_fmt;
    m->converted->sample_rate = m->encoder->sample_rate;
    m->converted->nb_samples = swr_get_out_samples(m->resampler, m->decoded->nb_samples);
    CHECK(av_channel_layout_copy(&m->converted->ch_layout, &m->encoder->ch_layout));
    CHECK(av_frame_get_buffer(m->converted, 0));
    int count = swr_convert(m->resampler, m->converted->data, m->converted->nb_samples,
                            (const uint8_t **)m->decoded->extended_data, m->decoded->nb_samples);
    if (count < 0) return count;
    CHECK(av_audio_fifo_realloc(m->fifo, av_audio_fifo_size(m->fifo) + count));
    return av_audio_fifo_write(m->fifo, (void **)m->converted->data, count) == count ? 0 : AVERROR(EIO);
failed:
    return error;
}

static int next_audio(ArkMovie *m) {
    for (;;) {
        int error = avcodec_receive_packet(m->encoder, m->sound);
        if (error == 0) return 1;
        if (error == AVERROR_EOF) return 0;
        if (error != AVERROR(EAGAIN)) return error;
        int count = av_audio_fifo_size(m->fifo);
        if (count >= m->encoder->frame_size || (m->decoder_eof && count > 0)) {
            count = FFMIN(count, m->encoder->frame_size);
            av_frame_unref(m->frame);
            m->frame->format = m->encoder->sample_fmt;
            m->frame->sample_rate = m->encoder->sample_rate;
            m->frame->nb_samples = count;
            m->frame->pts = m->audio_pts;
            CHECK(av_channel_layout_copy(&m->frame->ch_layout, &m->encoder->ch_layout));
            CHECK(av_frame_get_buffer(m->frame, 0));
            if (av_audio_fifo_read(m->fifo, (void **)m->frame->data, count) != count) return AVERROR(EIO);
            m->audio_pts += count;
            CHECK(avcodec_send_frame(m->encoder, m->frame));
        } else if (m->decoder_eof) {
            if (m->encoder_flushed) return AVERROR_INVALIDDATA;
            CHECK(avcodec_send_frame(m->encoder, NULL)); m->encoder_flushed = 1;
        } else {
            error = avcodec_receive_frame(m->decoder, m->decoded);
            if (error == 0) { CHECK(convert_audio(m)); av_frame_unref(m->decoded); }
            else if (error == AVERROR_EOF) m->decoder_eof = 1;
            else if (error != AVERROR(EAGAIN)) return error;
            else {
                error = av_read_frame(m->audio, m->input);
                if (error == AVERROR_EOF) {
                    if (m->input_eof) return AVERROR_INVALIDDATA;
                    CHECK(avcodec_send_packet(m->decoder, NULL)); m->input_eof = 1;
                } else if (error < 0) return error;
                else {
                    if (m->input->stream_index == m->ai) error = avcodec_send_packet(m->decoder, m->input);
                    av_packet_unref(m->input);
                    if (error < 0) return error;
                }
            }
        }
        continue;
failed:
        return error;
    }
}

// Work in bounded batches so the browser can deliver progress and cancellation.
int ark_media_step(ArkMovie *m, int budget) {
    if (!m || budget <= 0) return AVERROR(EINVAL);
    if (m->done) return 0;
    for (int n = 0; n < budget; n++) {
        int error;
        if (!m->have_picture && !m->video_eof) {
            do { error = av_read_frame(m->video, m->picture); }
            while (error >= 0 && m->picture->stream_index != m->vi && (av_packet_unref(m->picture), 1));
            if (error == AVERROR_EOF) m->video_eof = 1;
            else if (error < 0) return error;
            else m->have_picture = 1;
        }
        if (!m->have_sound && !m->audio_eof) {
            error = next_audio(m);
            if (error < 0) return error;
            m->have_sound = error;
            if (!error) m->audio_eof = 1;
        }
        if (!m->have_picture && !m->have_sound) {
            error = av_write_trailer(m->output);
            m->done = 1;
            return error < 0 ? error : 0;
        }
        int picture = m->have_picture && (!m->have_sound || av_compare_ts(m->picture->pts, m->video->streams[m->vi]->time_base, m->sound->pts, m->encoder->time_base) <= 0);
        AVPacket *packet = picture ? m->picture : m->sound;
        AVStream *stream = m->output->streams[picture ? 0 : 1];
        av_packet_rescale_ts(packet, picture ? m->video->streams[m->vi]->time_base : m->encoder->time_base, stream->time_base);
        packet->stream_index = stream->index;
        error = av_interleaved_write_frame(m->output, packet);
        if (error < 0) return error;
        if (picture) m->have_picture = 0; else m->have_sound = 0;
    }
    return 1;
}
